//! Управление нодами: каталог, профили лимитов, TURN-серверы, подготовка
//! ноды и агент — весь путь через настоящий роутер на базе в памяти.

use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use serde_json::{Value, json};
use tower::ServiceExt;
use trust_message_tcp::runtime::RuntimeFile;
use trustme_admin::crypto::SecretBox;
use trustme_admin::probe::{BoxFuture, ProbeResult, Prober};
use trustme_admin::{AppState, api, app, db};

const PASSWORD: &str = "correct horse battery";

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

struct Harness {
    router: Router,
    cookie: String,
    db: sqlx::SqlitePool,
}

impl Harness {
    async fn new() -> Self {
        let db = db::open_in_memory().await.unwrap();
        let state = AppState::new(
            db.clone(),
            SecretBox::from_key([5u8; 32]),
            Arc::new(DownProber),
        )
        .with_deployment(
            "https://admin.example.org",
            "ghcr.io/darkildo/trustme_backend:v0.6.0",
        );
        let router = app(state);
        let token = api::ensure_setup_token(&db).await.unwrap().unwrap();
        let mut h = Self {
            router,
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
}

#[tokio::test]
async fn catalog_and_profiles() {
    let h = Harness::new().await;
    let (status, body) = h.call("GET", "/catalog", None).await;
    assert_eq!(status, StatusCode::OK);
    let settings = body["settings"].as_array().unwrap();
    assert!(
        settings
            .iter()
            .any(|s| s["key"] == "rate_limit_send_msgs_per_sec" && s["scope"] == "hot")
    );
    assert!(
        settings
            .iter()
            .any(|s| s["key"] == "ice_credential_ttl_secs" && s["group"] == "calls")
    );

    let (_, body) = h.call("GET", "/profiles", None).await;
    assert_eq!(body["profiles"][0]["id"], "default");
    assert_eq!(body["profiles"][0]["is_default"], true);

    let (status, body) = h
        .call(
            "POST",
            "/profiles",
            Some(json!({ "name": "Строгий", "settings": { "nope": 1 } })),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"]["message"].as_str().unwrap().contains("nope"));
    let (status, _) = h
        .call(
            "POST",
            "/profiles",
            Some(json!({ "name": "Сломанный", "settings": { "tcp_keepalive_secs": 60, "tcp_keepalive_interval_secs": 0 } })),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let (status, body) = h
        .call(
            "POST",
            "/profiles",
            Some(json!({ "name": "Строгий", "settings": { "rate_limit_send_msgs_per_sec": 20 } })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let strict = body["profile"]["id"].as_str().unwrap().to_owned();
    let (status, _) = h
        .call("POST", "/profiles", Some(json!({ "name": "строгий" })))
        .await;
    assert_eq!(status, StatusCode::CONFLICT);

    let (status, body) = h
        .call(
            "PATCH",
            &format!("/profiles/{strict}"),
            Some(json!({ "settings": { "rate_limit_send_msgs_per_sec": 25 } })),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["profile"]["settings"]["rate_limit_send_msgs_per_sec"],
        25
    );

    let (status, _) = h.call("DELETE", "/profiles/default", None).await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, body) = h
        .call("POST", &format!("/profiles/{strict}/default"), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["profile"]["is_default"], true);
    let (status, _) = h.call("POST", "/profiles/default/default", None).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = h.call("DELETE", &format!("/profiles/{strict}"), None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn turn_servers_keep_secrets_server_side() {
    let h = Harness::new().await;
    for (body, needle) in [
        (json!({ "name": "x", "urls": ["http://x"] }), "stun:"),
        (
            json!({ "name": "x", "urls": ["turn:x:3478"] }),
            "нужен secret",
        ),
        (
            json!({ "name": "x", "urls": ["turn:x:3478"], "secret": "short" }),
            "короче",
        ),
        (json!({ "name": "", "urls": ["stun:x:1"] }), "name"),
    ] {
        let (status, reply) = h.call("POST", "/turn-servers", Some(body)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(
            reply["error"]["message"].as_str().unwrap().contains(needle),
            "{reply}"
        );
    }
    let (status, body) = h
        .call(
            "POST",
            "/turn-servers",
            Some(json!({ "name": "Внешний", "urls": ["turn:turn.example.org:3478"], "secret": "0123456789abcdef0123" })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    let id = body["turn_server"]["id"].as_str().unwrap().to_owned();
    assert_eq!(body["turn_server"]["has_secret"], true);
    assert!(!body.to_string().contains("0123456789abcdef0123"));

    // Смена адресов без секрета сохраняет прежний секрет.
    let (status, body) = h
        .call(
            "PATCH",
            &format!("/turn-servers/{id}"),
            Some(json!({ "urls": ["turns:turn.example.org:5349"] })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["turn_server"]["has_secret"], true);
    let (status, _) = h
        .call(
            "PATCH",
            &format!("/turn-servers/{id}"),
            Some(json!({ "secret": "" })),
        )
        .await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "TURN без секрета не бывает"
    );

    let (_, list) = h.call("GET", "/turn-servers", None).await;
    assert_eq!(list["turn_servers"].as_array().unwrap().len(), 1);
    let (status, _) = h.call("DELETE", &format!("/turn-servers/{id}"), None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn provisioned_node_enrolls_reports_and_follows_settings() {
    let h = Harness::new().await;
    let (_, body) = h
        .call(
            "POST",
            "/turn-servers",
            Some(json!({ "name": "Внешний", "urls": ["stun:stun.example.org:3478"] })),
        )
        .await;
    let external = body["turn_server"]["id"].as_str().unwrap().to_owned();

    let (status, body) = h
        .call(
            "POST",
            "/nodes/provision",
            Some(json!({ "name": "Берлин", "public_host": "bad host" })),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    let (status, body) = h
        .call(
            "POST",
            "/nodes/provision",
            Some(json!({
                "name": "Берлин", "public_host": "203.0.113.10", "with_turn": true,
                "backend": "jetstream", "turn_server_ids": [external]
            })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let node = body["node_id"].as_str().unwrap().to_owned();
    let token = body["enroll"]["token"].as_str().unwrap().to_owned();
    let command = body["enroll"]["command"].as_str().unwrap();
    assert!(command.contains("enroll --url https://admin.example.org --token tme_"));

    let (_, list) = h.call("GET", "/nodes", None).await;
    assert_eq!(list["nodes"][0]["provisioning"], true);
    let (status, _) = h.call("POST", &format!("/nodes/{node}/probe"), None).await;
    assert_eq!(status, StatusCode::CONFLICT, "без ключа не пробуем");
    let (_, view) = h.call("GET", &format!("/nodes/{node}/runtime"), None).await;
    assert_eq!(view["state"], "no_agent");

    // Агент: неверный токен, затем настоящий.
    let enroll = |token: &str| json!({ "token": token, "hostname": "srv-1", "arch": "x86_64", "tmnode_version": "0.2.0" });
    let (status, _, _) = h
        .send(
            "POST",
            "/agent/enroll",
            Some(enroll("tme_wrong")),
            Some("x"),
        )
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, reply, _) = h
        .send("POST", "/agent/enroll", Some(enroll(&token)), Some("x"))
        .await;
    assert_eq!(status, StatusCode::OK, "{reply}");
    // tmnode кладёт node_id в node.toml как есть — его проверка должна пройти.
    let node_toml = format!(
        "schema = 1\n[node]\nname = \"Берлин\"\nid = \"{}\"\n[management]\nmode = \"managed\"\n\
         [endpoint]\naddr = \"203.0.113.10:18081\"\nnode_key = \"1111111111111111111111111111111111111111111111111111111111111111\"\n[runtime]\nkind = \"docker\"\n\
         container = \"message-service\"\ndata_dir = \"/var/lib/trustme/node\"\n\
         [delivery]\nbackend = \"jetstream\"\n",
        reply["node_id"].as_str().unwrap()
    );
    tmnode::node_config::NodeConfig::parse(&node_toml)
        .expect("node.toml от enroll проходит проверку tmnode");
    assert_eq!(reply["node_id"], node.to_ascii_lowercase());
    assert_eq!(
        reply["install"]["image"],
        "ghcr.io/darkildo/trustme_backend:v0.6.0"
    );
    assert_eq!(reply["install"]["backend"], "jetstream");
    let secret = reply["install"]["coturn"]["secret"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(secret.len(), 48);
    let agent_token = reply["agent_token"].as_str().unwrap().to_owned();
    let runtime = reply["runtime"]["content"].as_str().unwrap();
    let file = RuntimeFile::parse(runtime).unwrap();
    let ice = file.overlay(&Default::default(), 8 << 20).unwrap().ice;
    assert_eq!(ice.servers.len(), 2, "внешний STUN и coturn ноды");
    assert!(runtime.contains(&secret));
    // Токен одноразовый.
    let (status, _, _) = h
        .send("POST", "/agent/enroll", Some(enroll(&token)), Some("x"))
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // coturn ноды виден в списке, но удалить его отдельно нельзя.
    let (_, list) = h.call("GET", "/turn-servers", None).await;
    let coturn = list["turn_servers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| !t["managed_by_node"].is_null())
        .unwrap()
        .clone();
    assert!(!list.to_string().contains(&secret));
    let (status, _) = h
        .call(
            "DELETE",
            &format!("/turn-servers/{}", coturn["id"].as_str().unwrap()),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);

    // Heartbeat: ключ, отчёт, статус — в ответ желаемые настройки.
    let key = "ab".repeat(32);
    let report = json!({
        "format": "tmnode.report/1", "tmnode_version": "0.2.0", "generated_at": 1,
        "target": {}, "status": "warn",
        "counts": { "ok": 0, "skip": 0, "warn": 1, "error": 0, "fail": 0 },
        "checks": [{ "id": "host.disk", "status": "warn", "summary": "мало места" }]
    });
    let beat = |version: &str, key: &str| {
        json!({
            "tmnode_version": "0.2.0", "node_key": key, "report": report,
            "runtime_status": { "result": "applied", "version": version, "pending_restart": [] }
        })
    };
    let (status, _, _) = h
        .send(
            "POST",
            "/agent/heartbeat",
            Some(beat("x", &key)),
            Some("tma_wrong"),
        )
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, reply, _) = h
        .send(
            "POST",
            "/agent/heartbeat",
            Some(beat("old", &key)),
            Some(&agent_token),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{reply}");
    assert_eq!(reply["interval_secs"], 30);
    let desired = reply["runtime"]["version"].as_str().unwrap().to_owned();

    let (_, detail) = h.call("GET", &format!("/nodes/{node}"), None).await;
    assert_eq!(detail["node"]["node_key"], key.as_str());
    assert_eq!(detail["node"]["provisioning"], false);
    assert_eq!(
        detail["node"]["latest_report"]["checks"][0]["id"],
        "host.disk"
    );
    let (_, view) = h.call("GET", &format!("/nodes/{node}/runtime"), None).await;
    assert_eq!(view["state"], "pending");
    assert_eq!(view["agent"]["online"], true);
    assert_eq!(view["agent"]["hostname"], "srv-1");

    h.send(
        "POST",
        "/agent/heartbeat",
        Some(beat(&desired, &key)),
        Some(&agent_token),
    )
    .await;
    let (_, view) = h.call("GET", &format!("/nodes/{node}/runtime"), None).await;
    assert_eq!(view["state"], "applied");

    // Переопределение меняет желаемую версию — снова «ожидает».
    let (status, body) = h
        .call(
            "PATCH",
            &format!("/nodes/{node}"),
            Some(json!({ "overrides": { "rate_limit_send_msgs_per_sec": 9 } })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, _) = h
        .call(
            "PATCH",
            &format!("/nodes/{node}"),
            Some(json!({ "overrides": { "bogus": 1 } })),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (_, view) = h.call("GET", &format!("/nodes/{node}/runtime"), None).await;
    assert_eq!(view["state"], "pending");
    assert_eq!(view["settings"][0]["source"], "override");
    let (_, reply, _) = h
        .send(
            "POST",
            "/agent/heartbeat",
            Some(beat(&desired, &key)),
            Some(&agent_token),
        )
        .await;
    assert!(
        reply["runtime"]["content"]
            .as_str()
            .unwrap()
            .contains("rate_limit_send_msgs_per_sec = 9")
    );

    // Другой ключ у известной ноды — событие, пин не меняется.
    let other = "cd".repeat(32);
    h.send(
        "POST",
        "/agent/heartbeat",
        Some(beat(&desired, &other)),
        Some(&agent_token),
    )
    .await;
    h.send(
        "POST",
        "/agent/heartbeat",
        Some(beat(&desired, &other)),
        Some(&agent_token),
    )
    .await;
    let (_, detail) = h.call("GET", &format!("/nodes/{node}"), None).await;
    assert_eq!(detail["node"]["node_key"], key.as_str());
    let changed: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE kind = 'key_changed'")
        .fetch_one(&h.db)
        .await
        .unwrap();
    assert_eq!(changed, 1);

    // Профиль и TURN ноды меняются в PATCH.
    let (status, _) = h
        .call(
            "PATCH",
            &format!("/nodes/{node}"),
            Some(json!({ "profile_id": "missing" })),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = h
        .call(
            "PATCH",
            &format!("/nodes/{node}"),
            Some(json!({ "profile_id": "", "turn_server_ids": [] })),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let (_, view) = h.call("GET", &format!("/nodes/{node}/runtime"), None).await;
    assert_eq!(view["turn_server_ids"].as_array().unwrap().len(), 0);
    assert_eq!(view["profile"]["id"], "default");

    // Новая команда установки — только для подготовленных нод.
    let (status, body) = h
        .call("POST", &format!("/nodes/{node}/enroll-token"), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["enroll"]["command"].as_str().unwrap().contains("tme_"));
    let (_, manual) = h
        .call(
            "POST",
            "/nodes",
            Some(json!({ "name": "Ручная", "addr": "198.51.100.1:18081", "node_key": key })),
        )
        .await;
    let manual = manual["node"]["id"].as_str().unwrap().to_owned();
    let (status, _) = h
        .call("POST", &format!("/nodes/{manual}/enroll-token"), None)
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _) = h.call("POST", "/nodes/missing/enroll-token", None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

/// Отчёт `tmnode doctor`: на диске 13,5 ГиБ свободно 4,4 — меньше резерва 5 ГиБ.
fn short_disk_report() -> Value {
    json!({
        "format": "tmnode.report/1", "tmnode_version": "0.2.0", "generated_at": 1,
        "target": {}, "status": "warn",
        "counts": { "ok": 1, "skip": 0, "warn": 1, "error": 0, "fail": 0 },
        "checks": [
            { "id": "host.disk", "status": "ok", "summary": "",
              "data": { "available_bytes": 4_766_261_248u64, "total_bytes": 14_483_001_344u64 } },
            { "id": "host.blob_reserve", "status": "warn",
              "summary": "свободно 4.4 ГиБ при резерве 5.0 ГиБ: загрузка файлов получает QUOTA",
              "data": { "available_bytes": 4_766_261_248u64, "reserve_bytes": 5_368_709_120u64 } }
        ]
    })
}

/// Подготовить ноду, поставить агента и прислать первый отчёт.
async fn enrolled_node(h: &Harness, name: &str, host: &str, auto: Option<bool>) -> String {
    let mut body = json!({ "name": name, "public_host": host });
    if let Some(auto) = auto {
        body["auto_blob_reserve"] = json!(auto);
    }
    let (status, body) = h.call("POST", "/nodes/provision", Some(body)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let node = body["node_id"].as_str().unwrap().to_owned();
    let token = body["enroll"]["token"].as_str().unwrap();
    let (_, reply, _) = h
        .send(
            "POST",
            "/agent/enroll",
            Some(json!({ "token": token, "hostname": "vps", "arch": "x86_64", "tmnode_version": "0.2.0" })),
            Some("x"),
        )
        .await;
    let agent = reply["agent_token"].as_str().unwrap().to_owned();
    let beat = json!({
        "tmnode_version": "0.2.0", "node_key": "cd".repeat(32), "report": short_disk_report(),
        "runtime_status": { "result": "applied", "version": "x", "pending_restart": [] }
    });
    let (status, reply, _) = h
        .send("POST", "/agent/heartbeat", Some(beat), Some(&agent))
        .await;
    assert_eq!(status, StatusCode::OK, "{reply}");
    node
}

#[tokio::test]
async fn blob_reserve_is_fitted_to_small_disks() {
    const FITTED: u64 = 1280 << 20; // 10 % от 13,5 ГиБ, кратно 256 МиБ

    // По умолчанию панель сама подбирает резерв по первому отчёту.
    let h = Harness::new().await;
    let auto = enrolled_node(&h, "Авто", "203.0.113.20", None).await;
    let (_, view) = h
        .call("GET", &format!("/nodes/{auto}/blob-reserve"), None)
        .await;
    assert_eq!(view["panel_bytes"], FITTED);
    assert_eq!(
        view["reserve_bytes"],
        5u64 << 30,
        "отчёт tmnode пока прежний"
    );
    assert!(
        view["suggested_bytes"].is_null(),
        "в панели резерв уже подобран: {view}"
    );
    let (_, runtime) = h.call("GET", &format!("/nodes/{auto}/runtime"), None).await;
    assert_eq!(runtime["state"], "pending", "новый runtime ждёт агента");
    let (_, log) = h.call("GET", "/audit", None).await;
    let entry = log["entries"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["action"] == "node.blob_reserve")
        .unwrap()
        .clone();
    assert_eq!(entry["details"]["auto"], true);
    assert_eq!(entry["details"]["to"], FITTED);

    // Без автоподбора — предложение и кнопка.
    let manual = enrolled_node(&h, "Кнопка", "203.0.113.21", Some(false)).await;
    let path = format!("/nodes/{manual}/blob-reserve");
    let (_, view) = h.call("GET", &path, None).await;
    assert!(view["panel_bytes"].is_null());
    assert_eq!(view["suggested_bytes"], FITTED);
    assert_eq!(view["total_bytes"], 14_483_001_344u64);
    assert_eq!(view["managed"], true);
    let (status, body) = h.call("POST", &path, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["reserve_bytes"], FITTED);
    let (_, view) = h.call("GET", &path, None).await;
    assert_eq!(view["panel_bytes"], FITTED);
    let (status, _) = h.call("POST", &path, None).await;
    assert_eq!(status, StatusCode::CONFLICT, "второй раз подбирать нечего");

    // Нода без агента: настройку панель не доставит.
    let (_, created) = h
        .call(
            "POST",
            "/nodes",
            Some(json!({ "name": "Ручная", "addr": "198.51.100.2:18081", "node_key": "ef".repeat(32) })),
        )
        .await;
    let plain = created["node"]["id"].as_str().unwrap();
    let path = format!("/nodes/{plain}/blob-reserve");
    let (_, view) = h.call("GET", &path, None).await;
    assert_eq!(view["managed"], false);
    let (status, _) = h.call("POST", &path, None).await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _) = h.call("GET", "/nodes/missing/blob-reserve", None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn queue_addressing_is_a_flag_older_nodes_do_not_get() {
    let h = Harness::new().await;
    let (_, body) = h.call("GET", "/catalog", None).await;
    let flag = body["settings"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["key"] == "queue_addressing_enabled")
        .cloned()
        .expect("флаг в каталоге");
    assert_eq!(flag["unit"], "flag");
    assert_eq!(flag["scope"], "restart");
    assert_eq!(flag["default"], 1, "включена по умолчанию");
    assert_eq!(flag["since"], "0.8.0");
    assert_eq!(body["settings"][0]["since"], Value::Null);

    let (_, body) = h
        .call(
            "POST",
            "/nodes/provision",
            Some(json!({ "name": "Очереди", "public_host": "203.0.113.30" })),
        )
        .await;
    let node = body["node_id"].as_str().unwrap().to_owned();
    let token = body["enroll"]["token"].as_str().unwrap();
    let (_, reply, _) = h
        .send(
            "POST",
            "/agent/enroll",
            Some(json!({ "token": token, "hostname": "vps", "arch": "x86_64", "tmnode_version": "0.7.0" })),
            Some("x"),
        )
        .await;
    let agent = reply["agent_token"].as_str().unwrap().to_owned();

    let (status, body) = h
        .call(
            "PATCH",
            &format!("/nodes/{node}"),
            Some(json!({ "overrides": { "queue_addressing_enabled": 0, "limit_max_connections": 10 } })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, _) = h
        .call(
            "PATCH",
            &format!("/nodes/{node}"),
            Some(json!({ "overrides": { "queue_addressing_enabled": 2 } })),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // Нода 0.7.0 флага не знает и отвергла бы весь файл — ей он не отдаётся.
    // Образ без версии или агент, не приславший образ, получают всё.
    for (image, unsupported, in_file) in [
        (
            Some("ghcr.io/darkildo/trustme_backend:v0.7.0"),
            json!(["queue_addressing_enabled"]),
            false,
        ),
        (
            Some("ghcr.io/darkildo/trustme_backend:v0.8.0"),
            json!([]),
            true,
        ),
        (
            Some("ghcr.io/darkildo/trustme_backend:stable"),
            json!([]),
            true,
        ),
        (None, json!([]), true),
    ] {
        let beat = json!({ "tmnode_version": "0.7.0", "node_image": image });
        let (status, reply, _) = h
            .send("POST", "/agent/heartbeat", Some(beat), Some(&agent))
            .await;
        assert_eq!(status, StatusCode::OK, "{reply}");
        let doc = reply["runtime"]["content"].as_str().unwrap();
        assert_eq!(
            doc.contains("queue_addressing_enabled = 0"),
            in_file,
            "{image:?}: {doc}"
        );
        assert!(doc.contains("limit_max_connections = 10"), "{image:?}");
        let (_, view) = h.call("GET", &format!("/nodes/{node}/runtime"), None).await;
        assert_eq!(view["unsupported"], unsupported, "{image:?}");
        assert_eq!(
            view["desired_version"], reply["runtime"]["version"],
            "{image:?}"
        );
    }
}
