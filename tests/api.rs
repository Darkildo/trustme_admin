//! API целиком: настоящий роутер, база в памяти, подставная проба.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use serde_json::{Value, json};
use tower::ServiceExt;
use trustme_admin::crypto::SecretBox;
use trustme_admin::probe::{BoxFuture, ProbeConfig, ProbeResult, Prober};
use trustme_admin::{AppState, api, app, db};

const KEY: &str = "005bdc6b8a958d7f7d8504dac2e7ff5ab506b491d9259432b303a0ca9ae9ed79";
const PASSWORD: &str = "correct horse battery";

/// Проба, исход которой задаёт тест.
struct FakeProber {
    up: AtomicBool,
}

impl Prober for FakeProber {
    fn probe<'a>(&'a self, _addr: &'a str, _key: [u8; 32]) -> BoxFuture<'a, ProbeResult> {
        let up = self.up.load(Ordering::SeqCst);
        Box::pin(async move {
            if up {
                ProbeResult {
                    ok: true,
                    stage: None,
                    error: None,
                    connect_ms: Some(2),
                    handshake_ms: Some(9),
                    config: Some(ProbeConfig {
                        proto_version: 1,
                        expires_at: 2_000_000_000,
                        supports_delivery_ack: true,
                        supports_queue_addressing: true,
                        supports_blobs: true,
                        blob_max_size: 1 << 30,
                    }),
                }
            } else {
                ProbeResult {
                    ok: false,
                    stage: Some("handshake"),
                    error: Some("noise handshake: closed".into()),
                    connect_ms: None,
                    handshake_ms: None,
                    config: None,
                }
            }
        })
    }
}

struct TestApp {
    router: Router,
    db: sqlx::SqlitePool,
    prober: Arc<FakeProber>,
    cookie: Option<String>,
}

struct Reply {
    status: StatusCode,
    body: Value,
    set_cookie: Option<String>,
    retry_after: Option<String>,
}

impl TestApp {
    async fn new() -> Self {
        let db = db::open_in_memory().await.unwrap();
        let prober = Arc::new(FakeProber {
            up: AtomicBool::new(true),
        });
        let state = AppState::new(db.clone(), SecretBox::from_key([3u8; 32]), prober.clone());
        Self {
            router: app(state),
            db,
            prober,
            cookie: None,
        }
    }

    async fn call(&self, method: &str, path: &str, body: Option<Value>, csrf: bool) -> Reply {
        let mut builder = Request::builder()
            .method(method)
            .uri(format!("/api/v1{path}"));
        if let Some(cookie) = &self.cookie {
            builder = builder.header(header::COOKIE, cookie);
        }
        if csrf {
            builder = builder.header("x-trustme-admin", "1");
        }
        let request = match body {
            Some(body) => builder
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body.to_string())),
            None => builder.body(Body::empty()),
        }
        .unwrap();
        self.send(request).await
    }

    async fn send(&self, request: Request<Body>) -> Reply {
        let response = self.router.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let header = |name| {
            response
                .headers()
                .get(name)
                .map(|v: &header::HeaderValue| v.to_str().unwrap().to_owned())
        };
        let set_cookie = header(header::SET_COOKIE);
        let retry_after = header(header::RETRY_AFTER);
        let bytes = axum::body::to_bytes(response.into_body(), 1 << 20)
            .await
            .unwrap();
        let body = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        Reply {
            status,
            body,
            set_cookie,
            retry_after,
        }
    }

    async fn get(&self, path: &str) -> Reply {
        self.call("GET", path, None, false).await
    }

    async fn post(&self, path: &str, body: Value) -> Reply {
        self.call("POST", path, Some(body), true).await
    }

    fn remember(&mut self, reply: &Reply) {
        let cookie = reply.set_cookie.as_ref().expect("session cookie");
        self.cookie = Some(cookie.split(';').next().unwrap().to_owned());
    }

    /// Пройти первичную настройку и остаться владельцем `alice`.
    async fn owner() -> Self {
        let mut app = Self::new().await;
        let token = api::ensure_setup_token(&app.db).await.unwrap().unwrap();
        let reply = app
            .post(
                "/setup",
                json!({ "token": token, "username": "alice", "password": PASSWORD }),
            )
            .await;
        assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.body);
        app.remember(&reply);
        app
    }

    async fn add_node(&self, name: &str, addr: &str) -> (String, String) {
        let reply = self
            .post(
                "/nodes",
                json!({ "name": name, "addr": addr, "node_key": KEY }),
            )
            .await;
        assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.body);
        (
            reply.body["node"]["id"].as_str().unwrap().to_owned(),
            reply.body["ingest_token"].as_str().unwrap().to_owned(),
        )
    }

    async fn ingest(&self, token: &str, body: &str) -> Reply {
        let request = Request::builder()
            .method("POST")
            .uri("/api/v1/ingest/report")
            .header(header::AUTHORIZATION, format!("Bearer {token}"))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_owned()))
            .unwrap();
        self.send(request).await
    }
}

fn report(status: &str, disk: &str) -> String {
    json!({
        "format": "tmnode.report/1", "tmnode_version": "0.1.0", "generated_at": 1,
        "target": { "addr": "127.0.0.1:18081", "node_key": KEY },
        "status": status,
        "counts": { "ok": 1, "skip": 0, "warn": u8::from(disk == "warn"), "error": 0, "fail": u8::from(disk == "fail") },
        "checks": [
            { "id": "runtime.container", "status": "ok", "summary": "работает" },
            { "id": "host.disk", "status": disk, "summary": "свободно 1.7 ГиБ", "hint": "расширьте диск",
              "data": { "available_bytes": 1 } }
        ]
    })
    .to_string()
}

#[tokio::test]
async fn health_and_security_headers() {
    let app = TestApp::new().await;
    let request = Request::builder()
        .uri("/api/v1/health")
        .body(Body::empty())
        .unwrap();
    let response = app.router.clone().oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let csp = response.headers()[header::CONTENT_SECURITY_POLICY]
        .to_str()
        .unwrap();
    assert!(csp.contains("frame-ancestors 'none'") && !csp.contains("http"));
    assert_eq!(
        response.headers()[header::X_CONTENT_TYPE_OPTIONS],
        "nosniff"
    );

    let reply = app.get("/nope").await;
    assert_eq!(reply.status, StatusCode::NOT_FOUND);
    assert_eq!(reply.body["error"]["code"], "not_found");

    // Без собранной панели вместо неё — подсказка, а не пустой ответ.
    let request = Request::builder()
        .uri("/nodes/abc")
        .body(Body::empty())
        .unwrap();
    let response = app.router.clone().oneshot(request).await.unwrap();
    assert!(matches!(
        response.status(),
        StatusCode::OK | StatusCode::NOT_FOUND
    ));
}

#[tokio::test]
async fn setup_creates_the_first_owner_once() {
    let mut app = TestApp::new().await;
    assert_eq!(app.get("/setup").await.body, json!({ "needed": true }));
    let token = api::ensure_setup_token(&app.db).await.unwrap().unwrap();

    let reply = app
        .post(
            "/setup",
            json!({ "token": "tmo_wrong", "username": "alice", "password": PASSWORD }),
        )
        .await;
    assert_eq!(reply.status, StatusCode::FORBIDDEN);
    let reply = app
        .post(
            "/setup",
            json!({ "token": token, "username": "a", "password": PASSWORD }),
        )
        .await;
    assert_eq!(reply.status, StatusCode::BAD_REQUEST);
    let reply = app
        .post(
            "/setup",
            json!({ "token": token, "username": "alice", "password": "short" }),
        )
        .await;
    assert_eq!(reply.status, StatusCode::BAD_REQUEST);

    let reply = app
        .post(
            "/setup",
            json!({ "token": token, "username": "alice", "password": PASSWORD }),
        )
        .await;
    assert_eq!(reply.status, StatusCode::CREATED);
    assert_eq!(reply.body["user"]["role"], "owner");
    let cookie = reply.set_cookie.clone().unwrap();
    assert!(cookie.contains("HttpOnly") && cookie.contains("SameSite=Strict"));
    app.remember(&reply);

    assert_eq!(app.get("/setup").await.body, json!({ "needed": false }));
    assert!(api::ensure_setup_token(&app.db).await.unwrap().is_none());
    let reply = app
        .post(
            "/setup",
            json!({ "token": token, "username": "bob", "password": PASSWORD }),
        )
        .await;
    assert_eq!(reply.status, StatusCode::CONFLICT);
    assert_eq!(app.get("/auth/me").await.body["user"]["username"], "alice");
}

#[tokio::test]
async fn mutations_need_the_csrf_header() {
    let app = TestApp::owner().await;
    let reply = app
        .call(
            "POST",
            "/nodes",
            Some(json!({ "name": "x", "addr": "h:1", "node_key": KEY })),
            false,
        )
        .await;
    assert_eq!(reply.status, StatusCode::FORBIDDEN);
    assert_eq!(app.get("/nodes").await.body["nodes"], json!([]));
}

#[tokio::test]
async fn login_logout_and_brute_force() {
    let mut app = TestApp::owner().await;
    app.cookie = None;
    assert_eq!(app.get("/auth/me").await.status, StatusCode::UNAUTHORIZED);

    let reply = app
        .post(
            "/auth/login",
            json!({ "username": "alice", "password": "wrong password" }),
        )
        .await;
    assert_eq!(reply.status, StatusCode::UNAUTHORIZED);
    assert_eq!(reply.body["error"]["code"], "unauthorized");
    let reply = app
        .post(
            "/auth/login",
            json!({ "username": "nobody", "password": PASSWORD }),
        )
        .await;
    assert_eq!(reply.status, StatusCode::UNAUTHORIZED);

    let reply = app
        .post(
            "/auth/login",
            json!({ "username": "Alice", "password": PASSWORD }),
        )
        .await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.body);
    app.remember(&reply);
    assert_eq!(app.get("/auth/me").await.status, StatusCode::OK);

    let reply = app.post("/auth/logout", json!({})).await;
    assert_eq!(reply.status, StatusCode::NO_CONTENT);
    assert!(reply.set_cookie.unwrap().contains("Max-Age=0"));
    assert_eq!(app.get("/auth/me").await.status, StatusCode::UNAUTHORIZED);

    for _ in 0..5 {
        app.post(
            "/auth/login",
            json!({ "username": "alice", "password": "nope nope nope" }),
        )
        .await;
    }
    let reply = app
        .post(
            "/auth/login",
            json!({ "username": "alice", "password": PASSWORD }),
        )
        .await;
    assert_eq!(reply.status, StatusCode::TOO_MANY_REQUESTS);
    assert!(reply.retry_after.is_some());
}

fn current_code(secret: &str) -> String {
    trustme_admin::auth::totp(secret, "alice")
        .unwrap()
        .generate_current()
        .to_string()
}

#[tokio::test]
async fn totp_guards_the_login() {
    let mut app = TestApp::owner().await;
    let reply = app
        .post("/auth/totp/enable", json!({ "code": "123456" }))
        .await;
    assert_eq!(reply.status, StatusCode::BAD_REQUEST);

    let reply = app.post("/auth/totp/setup", json!({})).await;
    let secret = reply.body["secret"].as_str().unwrap().to_owned();
    assert!(
        reply.body["otpauth_uri"]
            .as_str()
            .unwrap()
            .starts_with("otpauth://totp/")
    );
    let reply = app
        .post("/auth/totp/enable", json!({ "code": "000000" }))
        .await;
    assert_eq!(reply.status, StatusCode::BAD_REQUEST);
    let code = current_code(&secret);
    let reply = app.post("/auth/totp/enable", json!({ "code": code })).await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(reply.body["user"]["totp_enabled"], true);

    app.cookie = None;
    let reply = app
        .post(
            "/auth/login",
            json!({ "username": "alice", "password": PASSWORD }),
        )
        .await;
    assert_eq!(reply.body["error"]["code"], "totp_required");
    // Код, уже принятый при включении, повторно не проходит.
    let reply = app
        .post(
            "/auth/login",
            json!({ "username": "alice", "password": PASSWORD, "totp": code }),
        )
        .await;
    assert_eq!(reply.body["error"]["code"], "totp_required");

    // Свежий код: шаг сдвигаем вручную, чтобы не ждать 30 секунд.
    sqlx::query("UPDATE users SET totp_last_step = totp_last_step - 2")
        .execute(&app.db)
        .await
        .unwrap();
    let reply = app
        .post(
            "/auth/login",
            json!({ "username": "alice", "password": PASSWORD, "totp": code }),
        )
        .await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.body);
    app.remember(&reply);

    sqlx::query("UPDATE users SET totp_last_step = totp_last_step - 2")
        .execute(&app.db)
        .await
        .unwrap();
    let reply = app
        .post(
            "/auth/totp/disable",
            json!({ "password": "wrong password", "code": code }),
        )
        .await;
    assert_eq!(reply.status, StatusCode::BAD_REQUEST);
    let reply = app
        .post(
            "/auth/totp/disable",
            json!({ "password": PASSWORD, "code": code }),
        )
        .await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.body);
    assert_eq!(reply.body["user"]["totp_enabled"], false);
}

#[tokio::test]
async fn password_change_ends_other_sessions() {
    let mut app = TestApp::owner().await;
    let first = app.cookie.clone();
    let reply = app
        .post(
            "/auth/login",
            json!({ "username": "alice", "password": PASSWORD }),
        )
        .await;
    app.remember(&reply);

    let reply = app
        .post(
            "/auth/password",
            json!({ "current": "wrong", "new": "another long password" }),
        )
        .await;
    assert_eq!(reply.status, StatusCode::BAD_REQUEST);
    let reply = app
        .post(
            "/auth/password",
            json!({ "current": PASSWORD, "new": "another long password" }),
        )
        .await;
    assert_eq!(reply.status, StatusCode::NO_CONTENT);
    assert_eq!(app.get("/auth/me").await.status, StatusCode::OK);
    app.cookie = first;
    assert_eq!(app.get("/auth/me").await.status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn nodes_crud_and_probes() {
    let app = TestApp::owner().await;
    for (body, field) in [
        (
            json!({ "name": "", "addr": "h:1", "node_key": KEY }),
            "name",
        ),
        (json!({ "name": "a", "addr": "h", "node_key": KEY }), "addr"),
        (
            json!({ "name": "a", "addr": "h:1", "node_key": "00" }),
            "node_key",
        ),
        (
            json!({ "name": "a", "addr": "h:1", "node_key": KEY, "probe_interval_secs": 5 }),
            "probe_interval_secs",
        ),
        (
            json!({ "name": "a", "addr": "h:1", "node_key": KEY, "labels": { "Bad": "x" } }),
            "labels",
        ),
    ] {
        let reply = app.post("/nodes", body).await;
        assert_eq!(reply.status, StatusCode::BAD_REQUEST);
        assert!(
            reply.body["error"]["message"]
                .as_str()
                .unwrap()
                .contains(field)
        );
    }

    let (id, token) = app.add_node("Прод", "203.0.113.10:18081").await;
    assert!(token.starts_with("tmi_"));
    let reply = app
        .post(
            "/nodes",
            json!({ "name": "dup", "addr": "203.0.113.10:18081", "node_key": KEY }),
        )
        .await;
    assert_eq!(reply.status, StatusCode::CONFLICT);

    let reply = app.post(&format!("/nodes/{id}/probe"), json!({})).await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(reply.body["probe"]["ok"], true);
    assert_eq!(reply.body["probe"]["config"]["supports_blobs"], true);

    app.prober.up.store(false, Ordering::SeqCst);
    let reply = app.post(&format!("/nodes/{id}/probe"), json!({})).await;
    assert_eq!(reply.body["probe"]["stage"], "handshake");

    let node = app.get(&format!("/nodes/{id}")).await.body["node"].clone();
    assert_eq!(node["status"], "fail");
    assert_eq!(node["fingerprint"].as_str().unwrap().len(), 64 + 15);
    assert_eq!(node["has_ingest_token"], true);
    assert!(node["latest_report"].is_null());
    let uptime = node["uptime_24h"].as_f64().unwrap();
    assert!(uptime > 0.0 && uptime < 1.0);

    let probes = app.get(&format!("/nodes/{id}/probes")).await.body["probes"].clone();
    let probes = probes.as_array().unwrap();
    assert!(probes.len() >= 2);
    assert!(
        probes
            .windows(2)
            .all(|w| w[0]["at"].as_i64() <= w[1]["at"].as_i64())
    );
    let limited = app.get(&format!("/nodes/{id}/probes?limit=1")).await.body["probes"].clone();
    assert_eq!(limited.as_array().unwrap().len(), 1);
    assert_eq!(limited[0]["stage"], "handshake");

    let reply = app
        .call(
            "PATCH",
            &format!("/nodes/{id}"),
            Some(json!({ "name": "Прод-1", "labels": { "team": "core" }, "notes": "главная", "paused": true, "probe_interval_secs": 120 })),
            true,
        )
        .await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.body);
    assert_eq!(reply.body["node"]["name"], "Прод-1");
    assert_eq!(reply.body["node"]["labels"]["team"], "core");
    assert_eq!(reply.body["node"]["paused"], true);
    assert_eq!(reply.body["node"]["probe_interval_secs"], 120);
    let reply = app
        .call(
            "PATCH",
            &format!("/nodes/{id}"),
            Some(json!({ "addr": "bad" })),
            true,
        )
        .await;
    assert_eq!(reply.status, StatusCode::BAD_REQUEST);

    let list = app.get("/nodes").await.body["nodes"].clone();
    assert_eq!(list.as_array().unwrap().len(), 1);

    let reply = app
        .call("DELETE", &format!("/nodes/{id}"), None, true)
        .await;
    assert_eq!(reply.status, StatusCode::NO_CONTENT);
    assert_eq!(
        app.get(&format!("/nodes/{id}")).await.status,
        StatusCode::NOT_FOUND
    );
    let left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM probes")
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert_eq!(left, 0);
}

#[tokio::test]
async fn reports_are_ingested_by_token() {
    let app = TestApp::owner().await;
    let (id, token) = app.add_node("Прод", "203.0.113.10:18081").await;
    app.post(&format!("/nodes/{id}/probe"), json!({})).await;

    assert_eq!(
        app.ingest("tmi_wrong", &report("ok", "ok")).await.status,
        StatusCode::UNAUTHORIZED
    );
    let reply = app.ingest(&token, "{\"format\":\"tmnode.report/9\"}").await;
    assert_eq!(reply.status, StatusCode::UNPROCESSABLE_ENTITY);

    // Отклонённая попытка тоже считается: следующий отчёт — не раньше чем через 10 с.
    let reply = app.ingest(&token, &report("warn", "warn")).await;
    assert_eq!(reply.status, StatusCode::TOO_MANY_REQUESTS);

    // Дальше — на свежей установке, где окно приёма ещё не занято.
    let app = {
        let fresh = TestApp::owner().await;
        let (id, token) = fresh.add_node("Прод", "203.0.113.10:18081").await;
        fresh.post(&format!("/nodes/{id}/probe"), json!({})).await;
        let reply = fresh.ingest(&token, &report("warn", "warn")).await;
        assert_eq!(reply.status, StatusCode::ACCEPTED, "{}", reply.body);
        let rid = reply.body["report_id"].as_str().unwrap().to_owned();

        let node = fresh.get(&format!("/nodes/{id}")).await.body["node"].clone();
        assert_eq!(node["status"], "warn");
        assert_eq!(node["latest_report"]["checks"][1]["hint"], "расширьте диск");
        assert_eq!(node["latest_report"]["target"]["addr"], "127.0.0.1:18081");
        assert_eq!(node["last_report"]["counts"]["warn"], 1);

        let list = fresh.get(&format!("/nodes/{id}/reports")).await.body["reports"].clone();
        assert_eq!(list[0]["id"], rid.as_str());
        assert!(list[0].get("checks").is_none());
        let full = fresh.get(&format!("/nodes/{id}/reports/{rid}")).await;
        assert_eq!(full.body["report"]["checks"][0]["id"], "runtime.container");
        assert_eq!(
            fresh.get(&format!("/nodes/{id}/reports/nope")).await.status,
            StatusCode::NOT_FOUND
        );

        // Новый токен — старый перестаёт действовать.
        let reply = fresh
            .post(&format!("/nodes/{id}/ingest-token"), json!({}))
            .await;
        let new_token = reply.body["ingest_token"].as_str().unwrap().to_owned();
        assert_ne!(new_token, token);
        assert_eq!(
            fresh.ingest(&token, &report("ok", "ok")).await.status,
            StatusCode::UNAUTHORIZED
        );
        fresh
    };

    let overview = app.get("/overview").await.body;
    assert_eq!(overview["nodes"]["total"], 1);
    assert_eq!(overview["nodes"]["by_status"]["warn"], 1);
    assert_eq!(overview["tiles"][0]["handshake_ms"], 9);
    assert_eq!(overview["tiles"][0]["spark"].as_array().unwrap().len(), 24);
    assert_eq!(overview["latency"].as_array().unwrap().len(), 24);
    let events = overview["events"].as_array().unwrap();
    assert!(events.iter().any(|e| e["kind"] == "report_problem"
        && e["summary"].as_str().unwrap().starts_with("host.disk")));
    assert!(
        events
            .iter()
            .any(|e| e["kind"] == "status_changed" && e["to"] == "warn")
    );
}

#[tokio::test]
async fn users_roles_and_invites() {
    let mut app = TestApp::owner().await;
    let reply = app
        .post("/users", json!({ "username": "bob", "role": "viewer" }))
        .await;
    assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.body);
    let bob = reply.body["user"]["id"].as_str().unwrap().to_owned();
    let url = reply.body["invite_url"].as_str().unwrap().to_owned();
    let token = url.split("token=").nth(1).unwrap().to_owned();
    assert_eq!(
        app.post("/users", json!({ "username": "BOB", "role": "viewer" }))
            .await
            .status,
        StatusCode::CONFLICT
    );
    assert_eq!(
        app.post("/users", json!({ "username": "carol", "role": "root" }))
            .await
            .status,
        StatusCode::BAD_REQUEST
    );

    let owner_cookie = app.cookie.take();
    assert_eq!(
        app.get(&format!("/invite?token={token}")).await.body["username"],
        "bob"
    );
    assert_eq!(
        app.get("/invite?token=tmo_nope").await.status,
        StatusCode::NOT_FOUND
    );
    let reply = app
        .post("/invite", json!({ "token": token, "password": PASSWORD }))
        .await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.body);
    app.remember(&reply);
    // Ссылка одноразовая.
    assert_eq!(
        app.get(&format!("/invite?token={token}")).await.status,
        StatusCode::NOT_FOUND
    );

    // Наблюдатель видит, но не меняет.
    assert_eq!(app.get("/nodes").await.status, StatusCode::OK);
    let reply = app
        .post(
            "/nodes",
            json!({ "name": "x", "addr": "h:1", "node_key": KEY }),
        )
        .await;
    assert_eq!(reply.status, StatusCode::FORBIDDEN);
    assert_eq!(app.get("/audit").await.status, StatusCode::FORBIDDEN);
    assert_eq!(app.get("/users").await.status, StatusCode::FORBIDDEN);
    let bob_cookie = app.cookie.take();

    app.cookie = owner_cookie;
    let me = app.get("/auth/me").await.body["user"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let reply = app
        .call(
            "PATCH",
            &format!("/users/{me}"),
            Some(json!({ "role": "admin" })),
            true,
        )
        .await;
    assert_eq!(reply.status, StatusCode::CONFLICT);
    assert_eq!(
        app.call("DELETE", &format!("/users/{me}"), None, true)
            .await
            .status,
        StatusCode::CONFLICT
    );

    let reply = app
        .call(
            "PATCH",
            &format!("/users/{bob}"),
            Some(json!({ "role": "admin" })),
            true,
        )
        .await;
    assert_eq!(reply.body["user"]["role"], "admin");
    let reply = app
        .call(
            "PATCH",
            &format!("/users/{bob}"),
            Some(json!({ "disabled": true })),
            true,
        )
        .await;
    assert_eq!(reply.body["user"]["disabled"], true);
    let users = app.get("/users").await.body["users"].clone();
    assert_eq!(users.as_array().unwrap().len(), 2);

    let owner_cookie = app.cookie.take();
    app.cookie = bob_cookie;
    assert_eq!(app.get("/auth/me").await.status, StatusCode::UNAUTHORIZED);
    app.cookie = owner_cookie;

    assert_eq!(
        app.call("DELETE", &format!("/users/{bob}"), None, true)
            .await
            .status,
        StatusCode::NO_CONTENT
    );

    let audit = app.get("/audit?limit=100").await.body["entries"].clone();
    let actions: Vec<&str> = audit
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["action"].as_str().unwrap())
        .collect();
    for expected in [
        "setup.completed",
        "user.invited",
        "user.activated",
        "user.updated",
        "user.deleted",
    ] {
        assert!(actions.contains(&expected), "{expected} in {actions:?}");
    }
    let oldest = audit.as_array().unwrap().last().unwrap()["at"]
        .as_i64()
        .unwrap();
    let before = app.get(&format!("/audit?before={oldest}")).await.body["entries"].clone();
    assert_eq!(before.as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn pruning_keeps_history_bounded() {
    let app = TestApp::owner().await;
    let (id, _) = app.add_node("Прод", "203.0.113.10:18081").await;
    sqlx::query("INSERT INTO probes (id, node_id, at, ok) VALUES ('old', ?, 1, 1)")
        .bind(&id)
        .execute(&app.db)
        .await
        .unwrap();
    db::prune(&app.db, trustme_admin::now(), 14).await.unwrap();
    let old: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM probes WHERE id = 'old'")
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert_eq!(old, 0);
    trustme_admin::status::refresh_all(&app.db, trustme_admin::now())
        .await
        .unwrap();
}
