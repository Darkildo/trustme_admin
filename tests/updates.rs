//! Обновление ноды и агента из панели: релизы, задания, ход в heartbeat —
//! через настоящий роутер на базе в памяти. GitHub не трогаем: релизы
//! отдаёт подставной источник.

use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use serde_json::{Value, json};
use tower::ServiceExt;
use trustme_admin::crypto::SecretBox;
use trustme_admin::probe::{BoxFuture, ProbeResult, Prober};
use trustme_admin::releases::{Release, ReleaseSource, Releases, Version};
use trustme_admin::{AppState, api, app, db};

const PASSWORD: &str = "correct horse battery";
const IMAGE_V6: &str = "ghcr.io/darkildo/trustme_backend:v0.6.0";

fn sha(c: char) -> String {
    c.to_string().repeat(64)
}

struct DownProber;

impl Prober for DownProber {
    fn probe<'a>(&'a self, _addr: &'a str, _key: [u8; 32]) -> BoxFuture<'a, ProbeResult> {
        Box::pin(async {
            ProbeResult {
                ok: false,
                stage: Some("connect"),
                error: Some("down".into()),
                connect_ms: None,
                handshake_ms: None,
                config: None,
            }
        })
    }
}

/// v0.7.0 — tmnode под обе архитектуры, v0.6.0 — только x86_64, v0.2.0 —
/// без tmnode.
struct FakeReleases;

fn release(version: Version, arches: &[&str]) -> Release {
    Release {
        version,
        tag: format!("v{version}"),
        published_at: Some(1_792_324_800),
        url: format!("https://github.com/Darkildo/trustme_backend/releases/tag/v{version}"),
        tmnode_arches: arches.iter().map(|a| a.to_string()).collect(),
        sums_url: (!arches.is_empty()).then(|| format!("sums/v{version}")),
    }
}

impl ReleaseSource for FakeReleases {
    fn releases(&self) -> BoxFuture<'_, anyhow::Result<Vec<Release>>> {
        Box::pin(async {
            Ok(vec![
                release(Version::new(0, 7, 0), &["x86_64", "aarch64"]),
                release(Version::new(0, 6, 0), &["x86_64"]),
                release(Version::new(0, 2, 0), &[]),
            ])
        })
    }

    fn sha256sums<'a>(&'a self, release: &'a Release) -> BoxFuture<'a, anyhow::Result<String>> {
        Box::pin(async move {
            Ok(match release.tag.as_str() {
                "v0.7.0" => format!(
                    "{}  tmnode-x86_64-linux\n{}  tmnode-aarch64-linux\n",
                    sha('7'),
                    sha('a')
                ),
                _ => format!("{}  tmnode-x86_64-linux\n", sha('6')),
            })
        })
    }
}

struct Harness {
    router: Router,
    cookie: String,
    db: sqlx::SqlitePool,
}

impl Harness {
    async fn new() -> Self {
        Self::with(Releases::new(
            "Darkildo/trustme_backend",
            Arc::new(FakeReleases),
        ))
        .await
    }

    async fn with(releases: Releases) -> Self {
        let db = db::open_in_memory().await.unwrap();
        let state = AppState::new(
            db.clone(),
            SecretBox::from_key([5u8; 32]),
            Arc::new(DownProber),
        )
        .with_deployment("https://admin.example.org", IMAGE_V6)
        .with_releases(releases);
        let token = api::ensure_setup_token(&db).await.unwrap().unwrap();
        let mut h = Self {
            router: app(state),
            cookie: String::new(),
            db,
        };
        let (status, _, cookie) = h
            .send(
                "POST",
                "/setup",
                Some(json!({ "token": token, "username": "alice", "password": PASSWORD })),
                None,
            )
            .await;
        assert_eq!(status, StatusCode::CREATED);
        h.cookie = cookie.unwrap().split(';').next().unwrap().to_owned();
        h
    }

    async fn send(
        &self,
        method: &str,
        path: &str,
        body: Option<Value>,
        bearer: Option<&str>,
    ) -> (StatusCode, Value, Option<String>) {
        let mut builder = Request::builder()
            .method(method)
            .uri(format!("/api/v1{path}"));
        match bearer {
            Some(token) => {
                builder = builder.header(header::AUTHORIZATION, format!("Bearer {token}"))
            }
            None => {
                if !self.cookie.is_empty() {
                    builder = builder.header(header::COOKIE, &self.cookie);
                }
                builder = builder.header("x-trustme-admin", "1");
            }
        }
        let request = match body {
            Some(b) => builder
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(b.to_string())),
            None => builder.body(Body::empty()),
        }
        .unwrap();
        let response = self.router.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let cookie = response
            .headers()
            .get(header::SET_COOKIE)
            .map(|v| v.to_str().unwrap().to_owned());
        let bytes = axum::body::to_bytes(response.into_body(), 1 << 20)
            .await
            .unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
            cookie,
        )
    }

    async fn call(&self, method: &str, path: &str, body: Option<Value>) -> (StatusCode, Value) {
        let (s, b, _) = self.send(method, path, body, None).await;
        (s, b)
    }

    /// Нода с агентом: подготовить, подключить агента, первый heartbeat.
    async fn managed_node(&self, name: &str, host: &str, arch: &str, tmnode: &str) -> Agent {
        let (status, body) = self
            .call(
                "POST",
                "/nodes/provision",
                Some(json!({ "name": name, "public_host": host })),
            )
            .await;
        assert_eq!(status, StatusCode::CREATED, "{body}");
        let node = body["node_id"].as_str().unwrap().to_owned();
        let token = body["enroll"]["token"].as_str().unwrap();
        let (_, reply, _) = self
            .send(
                "POST",
                "/agent/enroll",
                Some(json!({ "token": token, "hostname": "vps", "arch": arch, "tmnode_version": tmnode })),
                Some("x"),
            )
            .await;
        let agent = Agent {
            node,
            token: reply["agent_token"].as_str().unwrap().to_owned(),
            tmnode: tmnode.to_owned(),
        };
        let (status, reply) = self.beat(&agent, Some(IMAGE_V6), None).await;
        assert_eq!(status, StatusCode::OK, "{reply}");
        agent
    }

    async fn beat(
        &self,
        agent: &Agent,
        image: Option<&str>,
        update: Option<Value>,
    ) -> (StatusCode, Value) {
        let beat = json!({
            "tmnode_version": agent.tmnode, "node_key": "cd".repeat(32), "report": null,
            "runtime_status": null, "node_image": image, "update": update,
        });
        let (s, b, _) = self
            .send("POST", "/agent/heartbeat", Some(beat), Some(&agent.token))
            .await;
        (s, b)
    }

    async fn audit(&self, action: &str) -> Vec<Value> {
        let (_, log) = self.call("GET", "/audit", None).await;
        log["entries"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|e| e["action"] == action)
            .cloned()
            .collect()
    }
}

struct Agent {
    node: String,
    token: String,
    tmnode: String,
}

#[tokio::test]
async fn releases_are_listed_with_tmnode_binaries() {
    let h = Harness::new().await;
    let (status, body) = h.call("GET", "/releases", None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["enabled"], true);
    assert_eq!(body["latest"], "0.7.0");
    assert_eq!(body["repo"], "Darkildo/trustme_backend");
    let releases = body["releases"].as_array().unwrap();
    assert_eq!(releases.len(), 3);
    assert_eq!(releases[0]["tag"], "v0.7.0");
    assert_eq!(releases[0]["published_at"], 1_792_324_800u64);
    assert_eq!(
        releases[1]["tmnode"],
        json!({ "x86_64": true, "aarch64": false })
    );
    assert_eq!(
        releases[2]["tmnode"],
        json!({ "x86_64": false, "aarch64": false })
    );

    let off = Harness::with(Releases::disabled()).await;
    let (_, body) = off.call("GET", "/releases", None).await;
    assert_eq!(body["enabled"], false);
    assert!(body["releases"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn bad_requests_are_refused() {
    let h = Harness::new().await;
    let agent = h
        .managed_node("Проверки", "203.0.113.13", "aarch64", "0.3.0")
        .await;
    let node = &agent.node;
    let h = &h;
    let create = |node: String, body: Value| async move {
        h.call("POST", &format!("/nodes/{node}/update"), Some(body))
            .await
    };

    let (status, _) = create(node.clone(), json!({})).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "нечего обновлять");
    let (status, _) = create(node.clone(), json!({ "node_version": "0.7" })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = create(node.clone(), json!({ "node_version": "0.9.0" })).await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "нет такого релиза"
    );
    let (status, body) = create(node.clone(), json!({ "tmnode_version": "0.6.0" })).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert!(
        body["error"]["message"]
            .as_str()
            .unwrap()
            .contains("aarch64")
    );
    let (status, _) = create(node.clone(), json!({ "tmnode_version": "0.2.0" })).await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "агент до 0.3.0 не умеет обновляться"
    );
    let (status, _) = create(
        node.clone(),
        json!({ "tmnode_version": "0.7.0", "tmnode_sha256": sha('0') }),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "хэш не совпал");
    let (status, body) = create(node.clone(), json!({ "tmnode_version": "0.7.0" })).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["update"]["tmnode_sha256"], sha('a'), "aarch64");
    assert_eq!(h.audit("node.update_created").await.len(), 1);

    // Нода по адресу и пину, нода без агента, нет ноды.
    let (_, manual) = h
        .call(
            "POST",
            "/nodes",
            Some(json!({ "name": "Ручная", "addr": "198.51.100.1:18081", "node_key": "ab".repeat(32) })),
        )
        .await;
    let manual = manual["node"]["id"].as_str().unwrap().to_owned();
    let (status, _) = create(manual.clone(), json!({ "node_version": "0.7.0" })).await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (_, view) = h
        .call("GET", &format!("/nodes/{manual}/updates"), None)
        .await;
    assert_eq!(view["current"]["managed"], false);
    assert_eq!(view["current"]["supports_updates"], false);
    let (_, fresh) = h
        .call(
            "POST",
            "/nodes/provision",
            Some(json!({ "name": "Новая", "public_host": "203.0.113.14" })),
        )
        .await;
    let fresh = fresh["node_id"].as_str().unwrap().to_owned();
    let (status, _) = create(fresh, json!({ "node_version": "0.7.0" })).await;
    assert_eq!(status, StatusCode::CONFLICT, "агента ещё нет");
    let (status, _) = create("missing".into(), json!({ "node_version": "0.7.0" })).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn old_agent_gets_the_upgrade_command() {
    let h = Harness::new().await;
    let agent = h
        .managed_node("Старый", "203.0.113.15", "x86_64", "0.2.0")
        .await;
    let node = &agent.node;
    let (_, view) = h.call("GET", &format!("/nodes/{node}/updates"), None).await;
    assert_eq!(view["current"]["supports_updates"], false);
    assert_eq!(view["current"]["min_agent_version"], "0.3.0");
    assert!(
        view["current"]["agent_upgrade_command"]
            .as_str()
            .unwrap()
            .ends_with("agent-upgrade")
    );
    let (status, body) = h
        .call(
            "POST",
            &format!("/nodes/{node}/update"),
            Some(json!({ "node_version": "0.7.0" })),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let message = body["error"]["message"].as_str().unwrap();
    assert!(
        message.contains("0.2.0") && message.contains("agent-upgrade"),
        "{message}"
    );

    // Агент до 0.3.0 не присылает node_image: версия ноды — из отчёта.
    let report = json!({
        "format": "tmnode.report/1", "tmnode_version": "0.2.0", "generated_at": 1,
        "target": {}, "status": "ok",
        "counts": { "ok": 1, "skip": 0, "warn": 0, "error": 0, "fail": 0 },
        "checks": [{ "id": "runtime.container", "status": "ok", "summary": "работает",
                     "data": { "image": IMAGE_V6 } }]
    });
    let beat = json!({ "tmnode_version": "0.2.0", "node_key": null, "report": report, "runtime_status": null });
    let (status, _, _) = h
        .send("POST", "/agent/heartbeat", Some(beat), Some(&agent.token))
        .await;
    assert_eq!(status, StatusCode::OK);
    let (_, view) = h.call("GET", &format!("/nodes/{node}/updates"), None).await;
    assert_eq!(view["current"]["node_image"], IMAGE_V6);
    assert_eq!(view["current"]["node_image_source"], "report");
    assert_eq!(view["current"]["node_version"], "0.6.0");
}

#[tokio::test]
async fn offline_panel_takes_versions_by_hand() {
    let h = Harness::with(Releases::disabled()).await;
    let agent = h
        .managed_node("Офлайн", "203.0.113.19", "x86_64", "0.3.0")
        .await;
    let node = &agent.node;
    let (status, body) = h
        .call(
            "POST",
            &format!("/nodes/{node}/update"),
            Some(json!({ "tmnode_version": "0.7.0" })),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "нужен хэш вручную");
    assert!(
        body["error"]["message"]
            .as_str()
            .unwrap()
            .contains("tmnode-x86_64-linux")
    );
    let (status, _) = h
        .call(
            "POST",
            &format!("/nodes/{node}/update"),
            Some(json!({ "tmnode_version": "0.7.0", "tmnode_sha256": "xyz" })),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, body) = h
        .call(
            "POST",
            &format!("/nodes/{node}/update"),
            Some(json!({ "node_version": "0.9.1", "tmnode_version": "0.9.1", "tmnode_sha256": sha('F') })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["update"]["tmnode_sha256"], sha('f'));
}

#[tokio::test]
async fn viewer_sees_but_cannot_update() {
    let h = Harness::new().await;
    let agent = h
        .managed_node("Наблюдение", "203.0.113.20", "x86_64", "0.3.0")
        .await;
    let (_, body) = h
        .call(
            "POST",
            &format!("/nodes/{}/update", agent.node),
            Some(json!({ "node_version": "0.7.0" })),
        )
        .await;
    let id = body["update"]["id"].as_str().unwrap().to_owned();
    let (_, invite) = h
        .call(
            "POST",
            "/users",
            Some(json!({ "username": "bob", "role": "viewer" })),
        )
        .await;
    let token = invite["invite_url"]
        .as_str()
        .unwrap()
        .split("token=")
        .nth(1)
        .unwrap()
        .to_owned();
    let mut viewer = Harness {
        router: h.router.clone(),
        cookie: String::new(),
        db: h.db.clone(),
    };
    let (status, _, cookie) = viewer
        .send(
            "POST",
            "/invite",
            Some(json!({ "token": token, "password": PASSWORD })),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    viewer.cookie = cookie.unwrap().split(';').next().unwrap().to_owned();

    let (status, _) = viewer.call("GET", "/releases", None).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = viewer
        .call("GET", &format!("/nodes/{}/updates", agent.node), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = viewer
        .call(
            "POST",
            &format!("/nodes/{}/update", agent.node),
            Some(json!({ "node_version": "0.7.0" })),
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = viewer
        .call(
            "POST",
            &format!("/nodes/{}/updates/{id}/cancel", agent.node),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}
