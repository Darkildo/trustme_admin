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
const IMAGE_V7: &str = "ghcr.io/darkildo/trustme_backend:v0.7.0";

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

/// v0.7.1 — tmnode только под x86_64, v0.7.0 — под обе архитектуры,
/// v0.6.0 — только x86_64 (tmnode старой нумерации), v0.2.0 — без tmnode.
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
                release(Version::new(0, 7, 1), &["x86_64"]),
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
                "v0.7.1" => format!("{}  tmnode-x86_64-linux\n", sha('1')),
                _ => format!("{}  tmnode-x86_64-linux\n", sha('6')),
            })
        })
    }
}

fn fake_releases() -> Releases {
    Releases::new("Darkildo/trustme_backend", Arc::new(FakeReleases))
}

struct Harness {
    router: Router,
    cookie: String,
    db: sqlx::SqlitePool,
}

impl Harness {
    async fn new() -> Self {
        Self::with(fake_releases(), IMAGE_V6).await
    }

    async fn with(releases: Releases, image: &str) -> Self {
        let db = db::open_in_memory().await.unwrap();
        let state = AppState::new(
            db.clone(),
            SecretBox::from_key([5u8; 32]),
            Arc::new(DownProber),
        )
        .with_deployment("https://admin.example.org", image)
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

fn progress(id: &str, state: &str, step: &str, error: Option<&str>) -> Value {
    json!({
        "id": id, "state": state, "step": step, "error": error,
        "started_at": 1_792_443_630u64, "finished_at": null,
        "from_node_image": IMAGE_V6, "node_image": if state == "succeeded" { IMAGE_V7 } else { IMAGE_V6 },
        "from_tmnode": "0.7.0", "tmnode": "0.7.0",
    })
}

#[tokio::test]
async fn releases_are_listed_with_tmnode_binaries() {
    let h = Harness::new().await;
    let (status, body) = h.call("GET", "/releases", None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["enabled"], true);
    assert_eq!(body["latest"], "0.7.1");
    assert_eq!(body["repo"], "Darkildo/trustme_backend");
    let releases = body["releases"].as_array().unwrap();
    assert_eq!(releases.len(), 4);
    assert_eq!(releases[1]["tag"], "v0.7.0");
    assert_eq!(releases[1]["published_at"], 1_792_324_800u64);
    assert_eq!(
        releases[0]["tmnode"],
        json!({ "x86_64": true, "aarch64": false })
    );
    assert_eq!(
        releases[3]["tmnode"],
        json!({ "x86_64": false, "aarch64": false })
    );

    let off = Harness::with(Releases::disabled(), IMAGE_V6).await;
    let (_, body) = off.call("GET", "/releases", None).await;
    assert_eq!(body["enabled"], false);
    assert!(body["releases"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn update_runs_through_heartbeats() {
    let h = Harness::new().await;
    let agent = h
        .managed_node("Берлин", "203.0.113.10", "x86_64", "0.7.0")
        .await;
    let node = &agent.node;

    let (_, view) = h.call("GET", &format!("/nodes/{node}/updates"), None).await;
    assert_eq!(view["current"]["node_image"], IMAGE_V6);
    assert_eq!(view["current"]["node_image_source"], "agent");
    assert_eq!(view["current"]["node_version"], "0.6.0");
    assert_eq!(view["current"]["tmnode_version"], "0.7.0");
    assert_eq!(view["current"]["supports_updates"], true);
    assert!(view["updates"].as_array().unwrap().is_empty());

    // Задание: sha256 — из SHA256SUMS под архитектуру агента.
    let (status, body) = h
        .call(
            "POST",
            &format!("/nodes/{node}/update"),
            Some(json!({ "node_version": "0.7.0", "tmnode_version": "v0.7.0" })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let update = body["update"].clone();
    let id = update["id"].as_str().unwrap().to_owned();
    assert_eq!(id, id.to_ascii_lowercase(), "ULID строчными");
    assert_eq!(id.len(), 26);
    assert_eq!(update["state"], "pending");
    assert_eq!(update["tmnode_sha256"], sha('7'));
    assert_eq!(update["created_by"], "alice");
    assert_eq!(h.audit("node.update_created").await.len(), 1);

    // Второе задание, пока первое не завершено, — 409.
    let (status, _) = h
        .call(
            "POST",
            &format!("/nodes/{node}/update"),
            Some(json!({ "node_version": "0.7.0" })),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);

    // Heartbeat без статуса — задание в ответе.
    let (_, reply) = h.beat(&agent, Some(IMAGE_V6), None).await;
    assert_eq!(reply["update"]["id"], id.as_str());
    assert_eq!(reply["update"]["node_version"], "0.7.0");
    assert_eq!(
        reply["update"]["tmnode"],
        json!({ "version": "0.7.0", "sha256": sha('7') })
    );
    assert_eq!(reply["update"]["allow_downgrade"], false);

    // running: задание остаётся в ответе, шаг виден в истории.
    let (_, reply) = h
        .beat(
            &agent,
            Some(IMAGE_V6),
            Some(status_of(&id, "running", "pull_image")),
        )
        .await;
    assert_eq!(reply["update"]["id"], id.as_str());
    let (_, view) = h.call("GET", &format!("/nodes/{node}/updates"), None).await;
    let job = &view["updates"][0];
    assert_eq!(job["state"], "running");
    assert_eq!(job["step"], "pull_image");
    assert_eq!(job["from_node_image"], IMAGE_V6);
    assert!(job["started_at"].is_i64());
    let (status, _) = h
        .call("POST", &format!("/nodes/{node}/updates/{id}/cancel"), None)
        .await;
    assert_eq!(status, StatusCode::CONFLICT, "агент уже начал");

    // Итог: задания в ответе больше нет, образ ноды — новый.
    let (_, reply) = h
        .beat(
            &agent,
            Some(IMAGE_V7),
            Some(progress(&id, "succeeded", "verify", None)),
        )
        .await;
    assert!(reply["update"].is_null(), "{reply}");
    let (_, view) = h.call("GET", &format!("/nodes/{node}/updates"), None).await;
    let job = &view["updates"][0];
    assert_eq!(job["state"], "succeeded");
    assert_eq!(job["to_node_image"], IMAGE_V7);
    assert_eq!(job["to_tmnode"], "0.7.0");
    assert!(job["finished_at"].is_i64());
    assert_eq!(view["current"]["node_version"], "0.7.0");

    // Повтор итога ничего не меняет и не пишет журнал второй раз.
    let (_, reply) = h
        .beat(
            &agent,
            Some(IMAGE_V7),
            Some(progress(&id, "succeeded", "verify", None)),
        )
        .await;
    assert!(reply["update"].is_null());
    let finished = h.audit("node.update_finished").await;
    assert_eq!(finished.len(), 1);
    assert_eq!(finished[0]["details"]["state"], "succeeded");
    assert_eq!(finished[0]["user"], "agent");

    // Теперь 0.7.0 — текущая: 0.6.0 без allow_downgrade — понижение.
    let (status, body) = h
        .call(
            "POST",
            &format!("/nodes/{node}/update"),
            Some(json!({ "node_version": "0.6.0" })),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    let (status, body) = h
        .call(
            "POST",
            &format!("/nodes/{node}/update"),
            Some(json!({ "node_version": "0.6.0", "allow_downgrade": true })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let (_, reply) = h.beat(&agent, Some(IMAGE_V7), None).await;
    assert_eq!(reply["update"]["allow_downgrade"], true);
    assert!(reply["update"]["tmnode"].is_null());
}

fn status_of(id: &str, state: &str, step: &str) -> Value {
    progress(id, state, step, None)
}

#[tokio::test]
async fn rolled_back_and_refused_are_final() {
    let h = Harness::new().await;
    let agent = h
        .managed_node("Откат", "203.0.113.11", "x86_64", "0.7.0")
        .await;
    let node = &agent.node;
    let path = format!("/nodes/{node}/update");
    let create = |body: Value| h.call("POST", &path, Some(body));

    let (_, body) = create(json!({ "node_version": "0.7.0" })).await;
    let id = body["update"]["id"].as_str().unwrap().to_owned();
    h.beat(
        &agent,
        Some(IMAGE_V6),
        Some(status_of(&id, "running", "recreate")),
    )
    .await;
    let (_, reply) = h
        .beat(
            &agent,
            Some(IMAGE_V6),
            Some(progress(
                &id,
                "rolled_back",
                "rollback",
                Some("рукопожатие не прошло"),
            )),
        )
        .await;
    assert!(reply["update"].is_null());
    let (_, view) = h.call("GET", &format!("/nodes/{node}/updates"), None).await;
    assert_eq!(view["updates"][0]["state"], "rolled_back");
    assert_eq!(view["updates"][0]["step"], "rollback");
    assert_eq!(view["updates"][0]["error"], "рукопожатие не прошло");
    assert_eq!(view["current"]["node_version"], "0.6.0");

    // Отказ приходит сразу итогом, без running.
    let (status, body) = create(json!({ "tmnode_version": "0.7.0" })).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let id = body["update"]["id"].as_str().unwrap().to_owned();
    let (_, reply) = h
        .beat(
            &agent,
            Some(IMAGE_V6),
            Some(progress(
                &id,
                "refused",
                "check",
                Some("management.mode не managed"),
            )),
        )
        .await;
    assert!(reply["update"].is_null());
    let (_, view) = h.call("GET", &format!("/nodes/{node}/updates"), None).await;
    let job = &view["updates"][0];
    assert_eq!(job["state"], "refused");
    assert!(job["started_at"].is_i64() && job["finished_at"].is_i64());
    let states: Vec<Value> = h
        .audit("node.update_finished")
        .await
        .iter()
        .map(|e| e["details"]["state"].clone())
        .collect();
    assert_eq!(states, [json!("refused"), json!("rolled_back")]);
}

#[tokio::test]
async fn cancel_only_while_pending() {
    let h = Harness::new().await;
    let agent = h
        .managed_node("Отмена", "203.0.113.12", "x86_64", "0.7.0")
        .await;
    let node = &agent.node;
    let (_, body) = h
        .call(
            "POST",
            &format!("/nodes/{node}/update"),
            Some(json!({ "node_version": "0.7.0" })),
        )
        .await;
    let id = body["update"]["id"].as_str().unwrap().to_owned();
    let (status, body) = h
        .call(
            "POST",
            &format!("/nodes/{node}/updates/{}/cancel", id.to_ascii_uppercase()),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["update"]["state"], "cancelled");
    assert_eq!(h.audit("node.update_cancelled").await.len(), 1);
    let (_, reply) = h.beat(&agent, Some(IMAGE_V6), None).await;
    assert!(reply["update"].is_null(), "отменённое не выдаётся");
    let (status, _) = h
        .call("POST", &format!("/nodes/{node}/updates/{id}/cancel"), None)
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _) = h
        .call("POST", &format!("/nodes/{node}/updates/nope/cancel"), None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Агент успел начать до отмены: running не воскрешает задание, итог —
    // записывается.
    h.beat(
        &agent,
        Some(IMAGE_V6),
        Some(status_of(&id, "running", "pull_image")),
    )
    .await;
    let (_, view) = h.call("GET", &format!("/nodes/{node}/updates"), None).await;
    assert_eq!(view["updates"][0]["state"], "cancelled");
    let (_, reply) = h
        .beat(
            &agent,
            Some(IMAGE_V7),
            Some(progress(&id, "succeeded", "verify", None)),
        )
        .await;
    assert!(reply["update"].is_null());
    let (_, view) = h.call("GET", &format!("/nodes/{node}/updates"), None).await;
    assert_eq!(view["updates"][0]["state"], "succeeded");
    assert_eq!(
        h.audit("node.update_finished").await[0]["details"]["late"],
        true
    );

    // Новое задание после отмены — можно.
    let (status, _) = h
        .call(
            "POST",
            &format!("/nodes/{node}/update"),
            Some(json!({ "tmnode_version": "0.7.0" })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
}

#[tokio::test]
async fn bad_requests_are_refused() {
    let h = Harness::new().await;
    let agent = h
        .managed_node("Проверки", "203.0.113.13", "aarch64", "0.7.0")
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
    let (status, body) = create(node.clone(), json!({ "tmnode_version": "0.7.1" })).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert!(
        body["error"]["message"]
            .as_str()
            .unwrap()
            .contains("aarch64")
    );
    let (status, _) = create(
        node.clone(),
        json!({ "tmnode_version": "0.6.0", "allow_downgrade": true }),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "tmnode до 0.7.0 не умеет обновляться"
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
    assert_eq!(view["current"]["min_agent_version"], "0.7.0");
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

    // Агент до 0.7.0 не присылает node_image: версия ноды — из отчёта.
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
async fn silent_agent_loses_the_update() {
    let h = Harness::new().await;
    let agent = h
        .managed_node("Молчун", "203.0.113.16", "x86_64", "0.7.0")
        .await;
    let node = &agent.node;
    let (_, body) = h
        .call(
            "POST",
            &format!("/nodes/{node}/update"),
            Some(json!({ "node_version": "0.7.0" })),
        )
        .await;
    let id = body["update"]["id"].as_str().unwrap().to_owned();
    h.beat(
        &agent,
        Some(IMAGE_V6),
        Some(status_of(&id, "running", "pull_image")),
    )
    .await;

    // Свежий running не теряется.
    let (_, view) = h.call("GET", &format!("/nodes/{node}/updates"), None).await;
    assert_eq!(view["updates"][0]["state"], "running");

    let long_ago = trustme_admin::now() as i64 - api::LOST_AFTER_SECS as i64 - 60;
    sqlx::query("UPDATE node_updates SET reported_at = ? WHERE id = ?")
        .bind(long_ago)
        .bind(&id)
        .execute(&h.db)
        .await
        .unwrap();
    let (_, view) = h.call("GET", &format!("/nodes/{node}/updates"), None).await;
    let job = &view["updates"][0];
    assert_eq!(job["state"], "lost");
    assert!(job["error"].as_str().unwrap().contains("tmnode-agent"));
    let lost = h.audit("node.update_finished").await;
    assert_eq!(lost.len(), 1);
    assert_eq!(lost[0]["details"]["state"], "lost");
    assert_eq!(lost[0]["user"], "system");

    // Потерянное не мешает новому и не выдаётся агенту.
    let (_, reply) = h.beat(&agent, Some(IMAGE_V6), None).await;
    assert!(reply["update"].is_null());

    // Агент вернулся с итогом — записывается поверх lost.
    h.beat(
        &agent,
        Some(IMAGE_V6),
        Some(progress(&id, "failed", "pull_image", Some("нет сети"))),
    )
    .await;
    let (_, view) = h.call("GET", &format!("/nodes/{node}/updates"), None).await;
    assert_eq!(view["updates"][0]["state"], "failed");
    assert_eq!(view["updates"][0]["error"], "нет сети");
    let (status, _) = h
        .call(
            "POST",
            &format!("/nodes/{node}/update"),
            Some(json!({ "node_version": "0.7.0" })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
}

#[tokio::test]
async fn foreign_and_unknown_statuses_are_ignored() {
    let h = Harness::new().await;
    let a = h
        .managed_node("Первая", "203.0.113.17", "x86_64", "0.7.0")
        .await;
    let b = h
        .managed_node("Вторая", "203.0.113.18", "x86_64", "0.7.0")
        .await;
    let (_, body) = h
        .call(
            "POST",
            &format!("/nodes/{}/update", a.node),
            Some(json!({ "node_version": "0.7.0" })),
        )
        .await;
    let id = body["update"]["id"].as_str().unwrap().to_owned();

    // Агент второй ноды присылает итог чужого задания.
    let (status, reply) = h
        .beat(
            &b,
            Some(IMAGE_V6),
            Some(progress(&id, "succeeded", "verify", None)),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert!(reply["update"].is_null());
    let (status, _) = h
        .beat(
            &b,
            Some(IMAGE_V6),
            Some(progress(
                "01jbzzzzzzzzzzzzzzzzzzzzzz",
                "running",
                "check",
                None,
            )),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let (_, view) = h
        .call("GET", &format!("/nodes/{}/updates", a.node), None)
        .await;
    assert_eq!(view["updates"][0]["state"], "pending");
    assert!(h.audit("node.update_finished").await.is_empty());
}

#[tokio::test]
async fn offline_panel_takes_versions_by_hand() {
    let h = Harness::with(Releases::disabled(), IMAGE_V6).await;
    let agent = h
        .managed_node("Офлайн", "203.0.113.19", "x86_64", "0.7.0")
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
        .managed_node("Наблюдение", "203.0.113.20", "x86_64", "0.7.0")
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

#[tokio::test]
async fn install_pins_the_latest_release() {
    const STABLE: &str = "ghcr.io/darkildo/trustme_backend:stable";
    async fn installed_image(h: &Harness) -> Value {
        let (_, body) = h
            .call(
                "POST",
                "/nodes/provision",
                Some(json!({ "name": "Новая", "public_host": "203.0.113.30" })),
            )
            .await;
        let token = body["enroll"]["token"].as_str().unwrap();
        let (status, reply, _) = h
            .send(
                "POST",
                "/agent/enroll",
                Some(json!({ "token": token, "hostname": "vps", "arch": "x86_64", "tmnode_version": "0.7.0" })),
                Some("x"),
            )
            .await;
        assert_eq!(status, StatusCode::OK, "{reply}");
        reply["install"]["image"].clone()
    }
    // :stable — тег последнего релиза: версия ноды известна с первого heartbeat.
    let h = Harness::with(fake_releases(), STABLE).await;
    assert_eq!(
        installed_image(&h).await,
        "ghcr.io/darkildo/trustme_backend:v0.7.1"
    );
    // Версионный тег в настройке и офлайн-панель — образ как есть.
    let h = Harness::with(fake_releases(), IMAGE_V6).await;
    assert_eq!(installed_image(&h).await, IMAGE_V6);
    let h = Harness::with(Releases::disabled(), STABLE).await;
    assert_eq!(installed_image(&h).await, STABLE);
}
