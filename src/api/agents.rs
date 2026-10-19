//! Новые ноды и агенты `tmnode` (trustme_backend: docs/agent-protocol.md).
//!
//! Администратор готовит ноду в панели и получает одноразовую команду
//! установки. На сервере `install.sh` ставит Docker и `tmnode`, а
//! `tmnode enroll` меняет токен на постоянный токен агента и задание на
//! установку. Дальше агент сам раз в полминуты присылает отчёт и забирает
//! желаемые настройки: входящих портов на сервере ноды админка не требует.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode, header};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tmnode::node_config::Backend;
use tmnode::protocol::{
    CoturnSpec, DEFAULT_INTERVAL_SECS, EnrollRequest, EnrollResponse, Heartbeat, HeartbeatResponse,
    InstallSpec,
};

use super::ingest::{parse_report, store_report};
use super::nodes::{check_addr, check_name};
use crate::audit::{self, Actor};
use crate::auth::{ClientIp, CurrentUser, Role};
use crate::crypto::{new_token, random_bytes, token_hash};
use crate::desired;
use crate::error::{ApiError, ApiResult};
use crate::{AppState, new_id, now};

/// Срок одноразового токена подключения.
const ENROLL_TOKEN_SECS: u64 = 24 * 3600;
/// Агент считается на связи, если heartbeat был не позже стольких
/// интервалов назад.
const ONLINE_INTERVALS: u64 = 3;
pub const COTURN_IMAGE: &str = "coturn/coturn:4.6.3";
const COTURN_PORT: u16 = 3478;
const RELAY_PORTS: (u16, u16) = (49160, 49200);
pub const INSTALL_SCRIPT: &str =
    "https://raw.githubusercontent.com/Darkildo/trustme_backend/stable/deploy/install.sh";

/// Задание на установку, сохранённое при подготовке ноды.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Provision {
    pub public_host: String,
    pub port: u16,
    pub backend: Backend,
    pub with_turn: bool,
    /// Подобрать резерв диска под файлы по первому отчёту (одноразово).
    #[serde(default)]
    pub auto_blob_reserve: bool,
}

/// Команда, которую администратор запускает на чистом сервере.
pub fn install_command(public_url: &str, token: &str) -> String {
    format!("curl -fsSL {INSTALL_SCRIPT} | sudo sh -s -- enroll --url {public_url} --token {token}")
}

#[derive(Deserialize)]
pub struct ProvisionIn {
    name: String,
    public_host: String,
    port: Option<u16>,
    backend: Option<Backend>,
    #[serde(default)]
    with_turn: bool,
    /// По умолчанию — да: на маленьком диске резерв 5 ГиБ не даст грузить файлы.
    auto_blob_reserve: Option<bool>,
    profile_id: Option<String>,
    #[serde(default)]
    turn_server_ids: Vec<String>,
    #[serde(default)]
    labels: std::collections::BTreeMap<String, String>,
}

async fn issue_enroll_token(state: &AppState, node_id: &str) -> ApiResult<Value> {
    let token = new_token("tme_");
    let now = now();
    sqlx::query("DELETE FROM enroll_tokens WHERE node_id = ?")
        .bind(node_id)
        .execute(&state.db)
        .await?;
    sqlx::query(
        "INSERT INTO enroll_tokens (token_hash, node_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
    )
    .bind(token_hash(&token))
    .bind(node_id)
    .bind((now + ENROLL_TOKEN_SECS) as i64)
    .bind(now as i64)
    .execute(&state.db)
    .await?;
    Ok(json!({
        "token": token,
        "expires_at": now + ENROLL_TOKEN_SECS,
        "command": install_command(&state.public_url, &token),
    }))
}

async fn check_profile(state: &AppState, profile_id: Option<&str>) -> ApiResult<()> {
    if let Some(id) = profile_id.filter(|id| !id.is_empty()) {
        let exists: Option<String> =
            sqlx::query_scalar("SELECT id FROM limit_profiles WHERE id = ?")
                .bind(id)
                .fetch_optional(&state.db)
                .await?;
        if exists.is_none() {
            return Err(ApiError::invalid(format!("profile_id: профиля {id} нет")));
        }
    }
    Ok(())
}

pub async fn set_turn_servers(state: &AppState, node_id: &str, ids: &[String]) -> ApiResult<()> {
    for id in ids {
        let exists: Option<String> = sqlx::query_scalar("SELECT id FROM turn_servers WHERE id = ?")
            .bind(id)
            .fetch_optional(&state.db)
            .await?;
        if exists.is_none() {
            return Err(ApiError::invalid(format!(
                "turn_server_ids: сервера {id} нет"
            )));
        }
    }
    let mut tx = state.db.begin().await?;
    // coturn самой ноды остаётся привязанным, пока его не сняли явно.
    sqlx::query("DELETE FROM node_turn WHERE node_id = ?")
        .bind(node_id)
        .execute(&mut *tx)
        .await?;
    for id in ids {
        sqlx::query("INSERT OR IGNORE INTO node_turn (node_id, turn_server_id) VALUES (?, ?)")
            .bind(node_id)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(())
}

/// `POST /nodes/provision` — новая нода, которую поставит агент.
pub async fn provision(
    State(state): State<AppState>,
    user: CurrentUser,
    Json(input): Json<ProvisionIn>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    user.require(Role::Admin)?;
    let name = check_name(&input.name)?;
    let port = input.port.unwrap_or(18081);
    let addr = check_addr(&format!("{}:{port}", input.public_host.trim()))?;
    let host_ok = input
        .public_host
        .trim()
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || ".-:[]".contains(c));
    if !host_ok {
        return Err(ApiError::invalid("public_host: IP или имя сервера"));
    }
    check_profile(&state, input.profile_id.as_deref()).await?;
    let labels = serde_json::to_string(&input.labels).expect("labels serialize");
    let provision = Provision {
        public_host: input.public_host.trim().to_owned(),
        port,
        backend: input.backend.unwrap_or(Backend::Sled),
        with_turn: input.with_turn,
        auto_blob_reserve: input.auto_blob_reserve.unwrap_or(true),
    };
    let id = new_id();
    let now = now() as i64;
    let inserted = sqlx::query(
        "INSERT INTO nodes (id, name, addr, node_key, labels, profile_id, provision, created_at, updated_at)
         VALUES (?, ?, ?, '', ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&name)
    .bind(&addr)
    .bind(&labels)
    .bind(input.profile_id.filter(|p| !p.is_empty()))
    .bind(serde_json::to_string(&provision).expect("provision serializes"))
    .bind(now)
    .bind(now)
    .execute(&state.db)
    .await;
    if let Err(sqlx::Error::Database(err)) = &inserted
        && err.is_unique_violation()
    {
        return Err(ApiError::conflict(format!(
            "нода с адресом {addr} уже есть"
        )));
    }
    inserted?;
    set_turn_servers(&state, &id, &input.turn_server_ids).await?;
    audit::record(
        &state.db,
        Actor::User(&user),
        "node.provisioned",
        Some(&name),
        json!({ "node_id": id, "addr": addr, "with_turn": input.with_turn }),
    )
    .await?;
    let enroll = issue_enroll_token(&state, &id).await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({ "node_id": id, "enroll": enroll })),
    ))
}

/// `POST /nodes/{id}/enroll-token` — новая команда установки (прежняя
/// гаснет). Нужна, если токен истёк или сервер переустанавливают.
pub async fn new_enroll_token(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    user.require(Role::Admin)?;
    let provision: Option<Option<String>> =
        sqlx::query_scalar("SELECT provision FROM nodes WHERE id = ?")
            .bind(&id)
            .fetch_optional(&state.db)
            .await?;
    match provision {
        None => return Err(ApiError::not_found()),
        Some(None) => {
            return Err(ApiError::conflict(
                "нода добавлена по адресу и пину: её ставили без админки",
            ));
        }
        Some(Some(_)) => {}
    }
    audit::record(
        &state.db,
        Actor::User(&user),
        "node.enroll_token",
        Some(&id),
        json!({}),
    )
    .await?;
    Ok(Json(
        json!({ "enroll": issue_enroll_token(&state, &id).await? }),
    ))
}

fn bearer(headers: &HeaderMap) -> ApiResult<&str> {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::trim)
        .ok_or_else(ApiError::unauthorized)
}

/// coturn ноды: найти или завести (с новым секретом) и привязать к ней.
async fn node_coturn(
    state: &AppState,
    node_id: &str,
    node_name: &str,
    host: &str,
) -> ApiResult<String> {
    let existing: Option<Vec<u8>> = sqlx::query_scalar(
        "SELECT secret FROM turn_servers WHERE node_id = ? AND secret IS NOT NULL",
    )
    .bind(node_id)
    .fetch_optional(&state.db)
    .await?;
    if let Some(sealed) = existing {
        return Ok(String::from_utf8_lossy(&state.secrets.open(&sealed)?).into_owned());
    }
    let secret = hex::encode(random_bytes::<24>());
    let id = new_id();
    let urls = vec![
        format!("stun:{host}:{COTURN_PORT}"),
        format!("turn:{host}:{COTURN_PORT}?transport=udp"),
        format!("turn:{host}:{COTURN_PORT}?transport=tcp"),
    ];
    let now = now() as i64;
    sqlx::query(
        "INSERT INTO turn_servers (id, name, urls, secret, node_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(format!("coturn · {node_name}"))
    .bind(serde_json::to_string(&urls).expect("urls serialize"))
    .bind(state.secrets.seal(secret.as_bytes()))
    .bind(node_id)
    .bind(now)
    .bind(now)
    .execute(&state.db)
    .await?;
    sqlx::query("INSERT OR IGNORE INTO node_turn (node_id, turn_server_id) VALUES (?, ?)")
        .bind(node_id)
        .bind(&id)
        .execute(&state.db)
        .await?;
    Ok(secret)
}

/// `POST /agent/enroll` — одноразовый токен меняется на токен агента.
pub async fn enroll(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    Json(input): Json<EnrollRequest>,
) -> ApiResult<Json<EnrollResponse>> {
    let now = now();
    let node_id: Option<String> = sqlx::query_scalar(
        "DELETE FROM enroll_tokens WHERE token_hash = ? AND expires_at > ? RETURNING node_id",
    )
    .bind(token_hash(input.token.trim()))
    .bind(now as i64)
    .fetch_optional(&state.db)
    .await?;
    let node_id = node_id.ok_or_else(|| ApiError {
        message: "токен подключения неверен или истёк — получите новую команду в панели".into(),
        ..ApiError::unauthorized()
    })?;
    let (name, provision): (String, Option<String>) =
        sqlx::query_as("SELECT name, provision FROM nodes WHERE id = ?")
            .bind(&node_id)
            .fetch_one(&state.db)
            .await?;
    let provision: Provision = provision
        .and_then(|p| serde_json::from_str(&p).ok())
        .ok_or_else(ApiError::internal)?;

    let agent_token = new_token("tma_");
    let agent_id = new_id();
    let clip = |s: &str| s.chars().take(64).collect::<String>();
    // Переустановка: прежний агент этой ноды больше не действует.
    sqlx::query("DELETE FROM agents WHERE node_id = ?")
        .bind(&node_id)
        .execute(&state.db)
        .await?;
    sqlx::query(
        "INSERT INTO agents (id, node_id, token_hash, hostname, arch, tmnode_version, enrolled_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&agent_id)
    .bind(&node_id)
    .bind(token_hash(&agent_token))
    .bind(clip(&input.hostname))
    .bind(clip(&input.arch))
    .bind(clip(&input.tmnode_version))
    .bind(now as i64)
    .execute(&state.db)
    .await?;

    let coturn = if provision.with_turn {
        let secret = node_coturn(&state, &node_id, &name, &provision.public_host).await?;
        Some(CoturnSpec {
            image: COTURN_IMAGE.into(),
            realm: provision.public_host.clone(),
            secret,
            port: COTURN_PORT,
            relay_min_port: RELAY_PORTS.0,
            relay_max_port: RELAY_PORTS.1,
        })
    } else {
        None
    };
    let runtime = desired::desired(&state.db, &state.secrets, &node_id).await?;
    audit::record(
        &state.db,
        Actor::Named {
            id: None,
            username: "agent",
            ip: ip.as_deref(),
        },
        "agent.enrolled",
        Some(&name),
        json!({ "node_id": node_id, "hostname": clip(&input.hostname) }),
    )
    .await?;
    Ok(Json(EnrollResponse {
        agent_id,
        agent_token,
        // tmnode пишет id в node.toml, а там допустимы только a-z, 0-9 и `-`.
        // ULID нечувствителен к регистру; heartbeat узнаёт ноду по токену.
        node_id: node_id.to_ascii_lowercase(),
        node_name: name,
        install: InstallSpec {
            image: state.node_image.clone(),
            public_host: provision.public_host,
            port: provision.port,
            backend: provision.backend,
            coturn,
        },
        runtime: Some(runtime),
    }))
}

/// `POST /agent/heartbeat` — отчёт и статус от агента, в ответ — желаемые
/// настройки.
pub async fn heartbeat(
    State(state): State<AppState>,
    ip: ClientIp,
    headers: HeaderMap,
    Json(beat): Json<Heartbeat>,
) -> ApiResult<Json<HeartbeatResponse>> {
    let token = bearer(&headers)?;
    let agent: Option<(String, String)> =
        sqlx::query_as("SELECT id, node_id FROM agents WHERE token_hash = ?")
            .bind(token_hash(token))
            .fetch_optional(&state.db)
            .await?;
    let (agent_id, node_id) = agent.ok_or_else(ApiError::unauthorized)?;
    let now = now();
    sqlx::query(
        "UPDATE agents SET last_seen_at = ?, tmnode_version = ?, runtime_status = ? WHERE id = ?",
    )
    .bind(now as i64)
    .bind(beat.tmnode_version.chars().take(64).collect::<String>())
    .bind(beat.runtime_status.as_ref().map(Value::to_string))
    .bind(&agent_id)
    .execute(&state.db)
    .await?;

    if let Some(key) = beat
        .node_key
        .as_deref()
        .and_then(|k| super::nodes::check_node_key(k).ok())
    {
        learn_key(&state, &node_id, &key, now).await?;
    }
    if let Some(report) = &beat.report {
        match parse_report(report.to_string().as_bytes()) {
            Ok(report) => {
                store_report(&state.db, &node_id, &report, now).await?;
                super::blob_reserve::auto_after_report(&state, &node_id, &report, ip).await?;
            }
            Err(err) => {
                tracing::warn!(node = %node_id, error = %err.message, "agent sent an unreadable report")
            }
        }
    }
    Ok(Json(HeartbeatResponse {
        interval_secs: DEFAULT_INTERVAL_SECS,
        runtime: Some(desired::desired(&state.db, &state.secrets, &node_id).await?),
        update: None,
    }))
}

/// Ключ ноды от агента. Первый раз — запоминается (нода начинает
/// проверяться пробами). Другой ключ у уже известной ноды — авария: клиенты
/// с прежним пином не подключатся; пин в панели не меняется молча.
async fn learn_key(state: &AppState, node_id: &str, key: &str, now: u64) -> ApiResult<()> {
    let current: String = sqlx::query_scalar("SELECT node_key FROM nodes WHERE id = ?")
        .bind(node_id)
        .fetch_one(&state.db)
        .await?;
    if current.is_empty() {
        sqlx::query("UPDATE nodes SET node_key = ?, updated_at = ? WHERE id = ?")
            .bind(key)
            .bind(now as i64)
            .bind(node_id)
            .execute(&state.db)
            .await?;
        return Ok(());
    }
    if current != key {
        let summary = format!(
            "ключ ноды на хосте сменился ({}…): клиенты с прежним пином не подключатся",
            &key[..8]
        );
        let last: Option<String> = sqlx::query_scalar(
            "SELECT summary FROM events WHERE node_id = ? AND kind = 'key_changed' ORDER BY at DESC LIMIT 1",
        )
        .bind(node_id)
        .fetch_optional(&state.db)
        .await?;
        if last.as_deref() != Some(summary.as_str()) {
            sqlx::query("INSERT INTO events (id, at, node_id, kind, summary) VALUES (?, ?, ?, 'key_changed', ?)")
                .bind(new_id())
                .bind(now as i64)
                .bind(node_id)
                .bind(summary)
                .execute(&state.db)
                .await?;
        }
    }
    Ok(())
}

/// Агент ноды для карточки и списка.
pub async fn agent_json(state: &AppState, node_id: &str) -> ApiResult<Value> {
    let row: Option<(String, String, String, i64, Option<i64>)> = sqlx::query_as(
        "SELECT hostname, arch, tmnode_version, enrolled_at, last_seen_at FROM agents WHERE node_id = ?",
    )
    .bind(node_id)
    .fetch_optional(&state.db)
    .await?;
    Ok(match row {
        None => Value::Null,
        Some((hostname, arch, version, enrolled_at, last_seen_at)) => json!({
            "hostname": hostname,
            "arch": arch,
            "tmnode_version": version,
            "enrolled_at": enrolled_at,
            "last_seen_at": last_seen_at,
            "online": last_seen_at.is_some_and(|at| now().saturating_sub(at as u64) <= DEFAULT_INTERVAL_SECS * ONLINE_INTERVALS),
        }),
    })
}

/// `GET /nodes/{id}/runtime` — лимиты и TURN ноды: что задано и что
/// применено. Секретов в ответе нет.
pub async fn runtime_view(
    State(state): State<AppState>,
    _user: CurrentUser,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    let provision: Option<Option<String>> =
        sqlx::query_scalar("SELECT provision FROM nodes WHERE id = ?")
            .bind(&id)
            .fetch_optional(&state.db)
            .await?;
    let provision = provision.ok_or_else(ApiError::not_found)?;
    let effective = desired::effective(&state.db, &id).await?;
    let doc = desired::desired(&state.db, &state.secrets, &id).await?;
    let turn: Vec<String> = sqlx::query_scalar(
        "SELECT turn_server_id FROM node_turn WHERE node_id = ? ORDER BY turn_server_id",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?;
    let status: Option<Option<String>> =
        sqlx::query_scalar("SELECT runtime_status FROM agents WHERE node_id = ?")
            .bind(&id)
            .fetch_optional(&state.db)
            .await?;
    let agent = agent_json(&state, &id).await?;
    let applied: Option<Value> = status.flatten().and_then(|s| serde_json::from_str(&s).ok());
    let state_label = match (&agent, &applied) {
        (Value::Null, _) => "no_agent",
        (_, None) => "pending",
        (_, Some(a)) if a["result"] == "invalid" => "invalid",
        (_, Some(a)) if a["version"] == doc.version.as_str() => "applied",
        _ => "pending",
    };
    let settings: Vec<Value> = effective
        .merged()
        .iter()
        .map(|(key, value)| {
            json!({
                "key": key,
                "value": value,
                "source": if effective.overrides.contains_key(key) { "override" } else { "profile" },
            })
        })
        .collect();
    Ok(Json(json!({
        "profile": { "id": effective.profile_id, "name": effective.profile_name },
        "overrides": effective.overrides,
        "settings": settings,
        "turn_server_ids": turn,
        "desired_version": doc.version,
        "provision": provision.and_then(|p| serde_json::from_str::<Value>(&p).ok()),
        "agent": agent,
        "applied": applied,
        "state": state_label,
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_points_at_the_stable_installer() {
        let cmd = install_command("https://admin.example.org", "tme_abc");
        assert!(cmd.starts_with("curl -fsSL https://raw.githubusercontent.com/Darkildo/trustme_backend/stable/deploy/install.sh"));
        assert!(cmd.ends_with("enroll --url https://admin.example.org --token tme_abc"));
    }
}

#[derive(Deserialize)]
pub struct SshIn {
    host: Option<String>,
    port: Option<u16>,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
    passphrase: Option<String>,
    sudo_password: Option<String>,
    host_fingerprint: Option<String>,
}

/// Сколько вывода задачи хранить.
const JOB_OUTPUT_LIMIT: usize = 256 * 1024;
/// Сколько хранить законченную задачу.
const JOB_KEEP_SECS: u64 = 3600;

/// `POST /nodes/{id}/ssh-install` — поставить ноду по SSH. Учётные данные
/// живут только в задаче и не пишутся ни в базу, ни в журнал.
pub async fn ssh_install(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<String>,
    Json(input): Json<SshIn>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    use crate::ssh::{Auth, Target};
    use zeroize::Zeroizing;

    user.require(Role::Admin)?;
    let provision: Option<Option<String>> =
        sqlx::query_scalar("SELECT provision FROM nodes WHERE id = ?")
            .bind(&id)
            .fetch_optional(&state.db)
            .await?;
    let provision: Provision = match provision {
        None => return Err(ApiError::not_found()),
        Some(p) => p
            .and_then(|p| serde_json::from_str(&p).ok())
            .ok_or_else(|| ApiError::conflict("нода добавлена по адресу и пину: ставить нечего"))?,
    };
    let username = input.username.trim().to_owned();
    if username.is_empty()
        || username.len() > 64
        || !username
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
    {
        return Err(ApiError::invalid("username: имя пользователя SSH"));
    }
    let host = input
        .host
        .unwrap_or(provision.public_host)
        .trim()
        .to_owned();
    if host.is_empty()
        || !host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || ".-:[]".contains(c))
    {
        return Err(ApiError::invalid("host: IP или имя сервера"));
    }
    let auth = match (input.password, input.private_key) {
        (_, Some(pem)) if !pem.trim().is_empty() => Auth::Key {
            pem: Zeroizing::new(pem),
            passphrase: input
                .passphrase
                .filter(|p| !p.is_empty())
                .map(Zeroizing::new),
        },
        (Some(password), _) if !password.is_empty() => Auth::Password(Zeroizing::new(password)),
        _ => return Err(ApiError::invalid("нужен пароль или закрытый ключ")),
    };
    let target = Target {
        host: host.clone(),
        port: input.port.unwrap_or(22),
        username: username.clone(),
        auth,
        sudo_password: input
            .sudo_password
            .filter(|p| !p.is_empty())
            .map(Zeroizing::new),
        host_fingerprint: input.host_fingerprint.filter(|f| !f.trim().is_empty()),
    };

    let enroll = issue_enroll_token(&state, &id).await?;
    let enroll_args = format!(
        "--url {} --token {}",
        state.public_url,
        enroll["token"].as_str().expect("token is a string")
    );
    let job_id = new_id();
    let started = now();
    {
        let mut jobs = state.jobs.lock().expect("jobs lock");
        jobs.retain(|_, job| {
            job.finished_at
                .is_none_or(|at| started < at + JOB_KEEP_SECS)
        });
        jobs.insert(
            job_id.clone(),
            crate::Job {
                id: job_id.clone(),
                node_id: id.clone(),
                status: "running",
                output: String::new(),
                exit_code: None,
                error: None,
                started_at: started,
                finished_at: None,
            },
        );
    }
    audit::record(
        &state.db,
        Actor::User(&user),
        "node.ssh_install",
        Some(&id),
        json!({ "host": host, "port": target.port, "username": username, "job_id": job_id }),
    )
    .await?;

    let task_state = state.clone();
    let task_id = job_id.clone();
    tokio::spawn(async move {
        let append = |text: &str| {
            let mut jobs = task_state.jobs.lock().expect("jobs lock");
            if let Some(job) = jobs.get_mut(&task_id)
                && job.output.len() < JOB_OUTPUT_LIMIT
            {
                job.output.push_str(text);
            }
        };
        let result = crate::ssh::install(target, &enroll_args, append).await;
        let mut jobs = task_state.jobs.lock().expect("jobs lock");
        if let Some(job) = jobs.get_mut(&task_id) {
            job.finished_at = Some(now());
            match result {
                Ok(0) => {
                    job.status = "succeeded";
                    job.exit_code = Some(0);
                }
                Ok(code) => {
                    job.status = "failed";
                    job.exit_code = Some(code);
                }
                Err(err) => {
                    job.status = "failed";
                    job.error = Some(format!("{err:#}"));
                }
            }
        }
    });
    Ok((StatusCode::ACCEPTED, Json(json!({ "job_id": job_id }))))
}

/// `GET /jobs/{id}` — ход установки.
pub async fn job(
    State(state): State<AppState>,
    _user: CurrentUser,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    let jobs = state.jobs.lock().expect("jobs lock");
    let job = jobs.get(&id).ok_or_else(ApiError::not_found)?;
    Ok(Json(json!({ "job": job })))
}
