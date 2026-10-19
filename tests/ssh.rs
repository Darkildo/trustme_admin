//! Установка по SSH против настоящего SSH-сервера в процессе: вход по
//! паролю, пароль sudo через stdin, отпечаток хоста, отказ во входе.

use std::sync::{Arc, Mutex};

use russh::keys::{Algorithm, HashAlg, PrivateKey};
use russh::server::{self, Auth, Msg, Server as _, Session};
use russh::{Channel, ChannelId};
use tokio::net::TcpListener;
use trustme_admin::ssh::{self, Target};
use zeroize::Zeroizing;

#[derive(Clone, Default)]
struct Seen {
    command: Arc<Mutex<Option<String>>>,
    stdin: Arc<Mutex<Vec<u8>>>,
}

#[derive(Clone)]
struct TestServer {
    seen: Seen,
}

impl server::Server for TestServer {
    type Handler = Self;
    fn new_client(&mut self, _: Option<std::net::SocketAddr>) -> Self {
        self.clone()
    }
}

impl server::Handler for TestServer {
    type Error = russh::Error;

    async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
        Ok(if user == "deploy" && password == "hunter2-long" {
            Auth::Accept
        } else {
            Auth::reject()
        })
    }

    async fn channel_open_session(
        &mut self,
        _channel: Channel<Msg>,
        reply: server::ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        reply.accept().await;
        Ok(())
    }

    async fn exec_request(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        *self.seen.command.lock().unwrap() = Some(String::from_utf8_lossy(data).into_owned());
        session.channel_success(channel)?;
        Ok(())
    }

    async fn data(
        &mut self,
        _channel: ChannelId,
        data: &[u8],
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.seen.stdin.lock().unwrap().extend_from_slice(data);
        Ok(())
    }

    async fn channel_eof(
        &mut self,
        channel: ChannelId,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        // «Установка» закончилась: вывод, код выхода, закрытие.
        session.data(channel, &b"Docker ok\nNode installed\n"[..])?;
        session.extended_data(channel, 1, &b"warning: slow disk\n"[..])?;
        session.exit_status_request(channel, 0)?;
        session.eof(channel)?;
        session.close(channel)?;
        Ok(())
    }
}

async fn spawn_server() -> (u16, Seen, String) {
    let key = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519).unwrap();
    let fingerprint = key.public_key().fingerprint(HashAlg::Sha256).to_string();
    let config = Arc::new(server::Config {
        keys: vec![key],
        auth_rejection_time: std::time::Duration::from_millis(10),
        auth_rejection_time_initial: Some(std::time::Duration::from_millis(0)),
        ..Default::default()
    });
    let seen = Seen::default();
    let mut server = TestServer { seen: seen.clone() };
    let socket = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = socket.local_addr().unwrap().port();
    tokio::spawn(async move {
        let _ = server.run_on_socket(config, &socket).await;
    });
    (port, seen, fingerprint)
}

fn target(port: u16, password: &str, fingerprint: Option<String>) -> Target {
    Target {
        host: "127.0.0.1".into(),
        port,
        username: "deploy".into(),
        auth: ssh::Auth::Password(Zeroizing::new(password.into())),
        sudo_password: None,
        host_fingerprint: fingerprint,
    }
}

#[tokio::test]
async fn install_runs_the_command_with_sudo_password_on_stdin() {
    let (port, seen, fingerprint) = spawn_server().await;
    let mut out = String::new();
    let code = ssh::install(
        target(port, "hunter2-long", Some(fingerprint.clone())),
        "--url https://admin.example.org --token tme_x",
        |text| out.push_str(text),
    )
    .await
    .unwrap();
    assert_eq!(code, 0);
    assert!(out.contains(&format!("ключ хоста: {fingerprint}")));
    assert!(out.contains("Node installed") && out.contains("slow disk"));

    let command = seen.command.lock().unwrap().clone().unwrap();
    assert!(
        command.contains(
            "sudo -S -p '' sh \"$T\" enroll --url https://admin.example.org --token tme_x"
        )
    );
    // Пароль — только во входном потоке, не в команде.
    assert!(!command.contains("hunter2-long"));
    assert_eq!(seen.stdin.lock().unwrap().as_slice(), b"hunter2-long\n");
}

#[tokio::test]
async fn wrong_password_and_foreign_host_key_are_refused() {
    let (port, _, _) = spawn_server().await;
    let err = ssh::install(target(port, "nope", None), "--url u --token t", |_| {})
        .await
        .unwrap_err();
    assert!(format!("{err:#}").contains("вход не принят"), "{err:#}");

    let err = ssh::install(
        target(port, "hunter2-long", Some("SHA256:not-this-one".into())),
        "--url u --token t",
        |_| {},
    )
    .await
    .unwrap_err();
    assert!(format!("{err:#}").contains("не совпадает"), "{err:#}");

    let err = ssh::install(target(1, "x", None), "--url u --token t", |_| {})
        .await
        .unwrap_err();
    assert!(format!("{err:#}").contains("SSH"), "{err:#}");
}

#[tokio::test]
async fn panel_runs_ssh_install_as_a_job() {
    use axum::body::Body;
    use axum::http::{Request, StatusCode, header};
    use serde_json::{Value, json};
    use tower::ServiceExt;

    let (port, seen, _) = spawn_server().await;
    let db = trustme_admin::db::open_in_memory().await.unwrap();
    let state = trustme_admin::AppState::new(
        db.clone(),
        trustme_admin::crypto::SecretBox::from_key([6u8; 32]),
        Arc::new(trustme_admin::probe::NetProber),
    )
    .with_deployment("https://admin.example.org", "img:1");
    let router = trustme_admin::app(state);
    let token = trustme_admin::api::ensure_setup_token(&db)
        .await
        .unwrap()
        .unwrap();

    let call = |method: &str, path: &str, body: Option<Value>, cookie: Option<String>| {
        let mut builder = Request::builder()
            .method(method)
            .uri(format!("/api/v1{path}"))
            .header("x-trustme-admin", "1");
        if let Some(cookie) = cookie {
            builder = builder.header(header::COOKIE, cookie);
        }
        let request = match body {
            Some(b) => builder
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(b.to_string())),
            None => builder.body(Body::empty()),
        }
        .unwrap();
        let router = router.clone();
        async move {
            let response = router.oneshot(request).await.unwrap();
            let status = response.status();
            let cookie = response
                .headers()
                .get(header::SET_COOKIE)
                .map(|v| v.to_str().unwrap().split(';').next().unwrap().to_owned());
            let bytes = axum::body::to_bytes(response.into_body(), 1 << 20)
                .await
                .unwrap();
            (
                status,
                serde_json::from_slice::<Value>(&bytes).unwrap_or(Value::Null),
                cookie,
            )
        }
    };

    let (_, _, cookie) = call(
        "POST",
        "/setup",
        Some(json!({ "token": token, "username": "alice", "password": "correct horse battery" })),
        None,
    )
    .await;
    let (_, body, _) = call(
        "POST",
        "/nodes/provision",
        Some(json!({ "name": "SSH-нода", "public_host": "127.0.0.1" })),
        cookie.clone(),
    )
    .await;
    let node = body["node_id"].as_str().unwrap().to_owned();

    let (status, _, _) = call(
        "POST",
        &format!("/nodes/{node}/ssh-install"),
        Some(json!({ "username": "deploy" })),
        cookie.clone(),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "нужен пароль или ключ");
    let (status, body, _) = call(
        "POST",
        &format!("/nodes/{node}/ssh-install"),
        Some(json!({ "username": "deploy", "port": port, "password": "hunter2-long" })),
        cookie.clone(),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{body}");
    let job = body["job_id"].as_str().unwrap().to_owned();

    let mut finished = Value::Null;
    for _ in 0..100 {
        let (_, body, _) = call("GET", &format!("/jobs/{job}"), None, cookie.clone()).await;
        if body["job"]["status"] != "running" {
            finished = body;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    assert_eq!(finished["job"]["status"], "succeeded", "{finished}");
    assert!(
        finished["job"]["output"]
            .as_str()
            .unwrap()
            .contains("Node installed")
    );
    let command = seen.command.lock().unwrap().clone().unwrap();
    assert!(command.contains("enroll --url https://admin.example.org --token tme_"));

    // В журнале — кто, куда и как, но не пароль.
    let audit: Vec<String> =
        sqlx::query_scalar("SELECT details FROM audit WHERE action = 'node.ssh_install'")
            .fetch_all(&db)
            .await
            .unwrap();
    assert_eq!(audit.len(), 1);
    assert!(audit[0].contains("deploy") && !audit[0].contains("hunter2-long"));

    let (status, _, _) = call("GET", "/jobs/nope", None, cookie).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}
