//! Ноды: список, карточка, изменение, пробы, отчёты, токен приёма отчётов.

use std::collections::BTreeMap;

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::SqlitePool;

use crate::audit::{self, Actor};
use crate::auth::{CurrentUser, Role};
use crate::crypto::{new_token, token_hash};
use crate::error::{ApiError, ApiResult};
use crate::probe::{ProbeConfig, run_and_record};
use crate::status::{self, NodeStatus};
use crate::{AppState, new_id, now};

const MAX_LABELS: usize = 32;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct NodeRow {
    pub id: String,
    pub name: String,
    pub addr: String,
    pub node_key: String,
    pub labels: String,
    pub notes: String,
    pub ingest_token_hash: Option<String>,
    pub probe_interval_secs: i64,
    pub paused: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

macro_rules! node_columns {
    () => {
        "id, name, addr, node_key, labels, notes, ingest_token_hash, \
                            probe_interval_secs, paused, created_at, updated_at"
    };
}

#[derive(Debug, Serialize)]
pub struct ProbeOut {
    pub id: String,
    pub at: i64,
    pub ok: bool,
    pub stage: Option<String>,
    pub error: Option<String>,
    pub connect_ms: Option<i64>,
    pub handshake_ms: Option<i64>,
    pub config: Option<ProbeConfig>,
}

#[derive(sqlx::FromRow)]
struct ProbeRow {
    id: String,
    at: i64,
    ok: bool,
    stage: Option<String>,
    error: Option<String>,
    connect_ms: Option<i64>,
    handshake_ms: Option<i64>,
    config: Option<String>,
}

impl From<ProbeRow> for ProbeOut {
    fn from(r: ProbeRow) -> Self {
        Self {
            id: r.id,
            at: r.at,
            ok: r.ok,
            stage: r.stage,
            error: r.error,
            connect_ms: r.connect_ms,
            handshake_ms: r.handshake_ms,
            config: r.config.and_then(|c| serde_json::from_str(&c).ok()),
        }
    }
}

macro_rules! probe_columns {
    () => {
        "id, at, ok, stage, error, connect_ms, handshake_ms, config"
    };
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ReportSummary {
    pub id: String,
    pub received_at: i64,
    pub generated_at: i64,
    pub status: String,
    pub tmnode_version: String,
    #[sqlx(json)]
    pub counts: Value,
}

macro_rules! report_columns {
    () => {
        "id, received_at, generated_at, status, tmnode_version, counts"
    };
}

/// Группы по 4 hex в верхнем регистре: `A1B2-C3D4-…`.
pub fn fingerprint(node_key: &str) -> String {
    node_key
        .as_bytes()
        .chunks(4)
        .map(|c| String::from_utf8_lossy(c).to_uppercase())
        .collect::<Vec<_>>()
        .join("-")
}

async fn last_probe(db: &SqlitePool, node_id: &str) -> sqlx::Result<Option<ProbeOut>> {
    Ok(sqlx::query_as::<_, ProbeRow>(concat!(
        "SELECT ",
        probe_columns!(),
        " FROM probes WHERE node_id = ? ORDER BY at DESC, id DESC LIMIT 1"
    ))
    .bind(node_id)
    .fetch_optional(db)
    .await?
    .map(Into::into))
}

async fn last_report(db: &SqlitePool, node_id: &str) -> sqlx::Result<Option<ReportSummary>> {
    sqlx::query_as::<_, ReportSummary>(concat!(
        "SELECT ",
        report_columns!(),
        " FROM reports WHERE node_id = ? ORDER BY received_at DESC, id DESC LIMIT 1"
    ))
    .bind(node_id)
    .fetch_optional(db)
    .await
}

/// Доля успешных проб за сутки по нодам.
pub async fn uptime_24h(db: &SqlitePool, now: u64) -> sqlx::Result<BTreeMap<String, f64>> {
    let rows: Vec<(String, f64)> =
        sqlx::query_as("SELECT node_id, AVG(ok) FROM probes WHERE at >= ? GROUP BY node_id")
            .bind(now as i64 - 86_400)
            .fetch_all(db)
            .await?;
    Ok(rows.into_iter().collect())
}

/// Нода в списке: то, что видно в таблице и на плитке.
pub async fn list_item(
    db: &SqlitePool,
    row: &NodeRow,
    uptime: Option<f64>,
    now: u64,
) -> sqlx::Result<Value> {
    let probe = last_probe(db, &row.id).await?;
    let report = last_report(db, &row.id).await?;
    let status = status::compute(
        probe.as_ref().map(|p| p.ok),
        report
            .as_ref()
            .map(|r| (r.status.as_str(), r.received_at as u64)),
        now,
    );
    let labels: Value = serde_json::from_str(&row.labels).unwrap_or_else(|_| json!({}));
    let agent: Option<(Option<i64>, String)> =
        sqlx::query_as("SELECT last_seen_at, hostname FROM agents WHERE node_id = ?")
            .bind(&row.id)
            .fetch_optional(db)
            .await?;
    Ok(json!({
        "provisioning": row.node_key.is_empty(),
        "agent": agent.map(|(last_seen_at, hostname)| json!({
            "last_seen_at": last_seen_at,
            "hostname": hostname,
        })),
        "id": row.id,
        "name": row.name,
        "addr": row.addr,
        "node_key": row.node_key,
        "fingerprint": fingerprint(&row.node_key),
        "labels": labels,
        "status": status,
        "paused": row.paused,
        "last_probe": probe,
        "last_report": report,
        "uptime_24h": uptime,
    }))
}

pub async fn all_nodes(db: &SqlitePool) -> sqlx::Result<Vec<NodeRow>> {
    sqlx::query_as::<_, NodeRow>(concat!(
        "SELECT ",
        node_columns!(),
        " FROM nodes ORDER BY name COLLATE NOCASE, id"
    ))
    .fetch_all(db)
    .await
}

async fn node_row(db: &SqlitePool, id: &str) -> ApiResult<NodeRow> {
    sqlx::query_as::<_, NodeRow>(concat!(
        "SELECT ",
        node_columns!(),
        " FROM nodes WHERE id = ?"
    ))
    .bind(id)
    .fetch_optional(db)
    .await?
    .ok_or_else(ApiError::not_found)
}

async fn detail_json(db: &SqlitePool, row: &NodeRow) -> ApiResult<Value> {
    let now = now();
    let uptime = uptime_24h(db, now).await?.get(&row.id).copied();
    let mut node = list_item(db, row, uptime, now).await?;
    let latest: Option<(String, String)> = sqlx::query_as(
        "SELECT id, body FROM reports WHERE node_id = ? ORDER BY received_at DESC, id DESC LIMIT 1",
    )
    .bind(&row.id)
    .fetch_optional(db)
    .await?;
    let latest_report = match latest {
        Some((rid, body)) => Some(full_report(db, &row.id, &rid, &body).await?),
        None => None,
    };
    let obj = node.as_object_mut().expect("list item is an object");
    obj.insert("notes".into(), json!(row.notes));
    obj.insert("probe_interval_secs".into(), json!(row.probe_interval_secs));
    obj.insert("created_at".into(), json!(row.created_at));
    obj.insert("updated_at".into(), json!(row.updated_at));
    obj.insert("latest_report".into(), latest_report.unwrap_or(Value::Null));
    obj.insert(
        "has_ingest_token".into(),
        json!(row.ingest_token_hash.is_some()),
    );
    Ok(node)
}

/// Отчёт целиком: сводка из таблицы плюс `target` и `checks` из тела.
async fn full_report(db: &SqlitePool, node_id: &str, rid: &str, body: &str) -> ApiResult<Value> {
    let summary = sqlx::query_as::<_, ReportSummary>(concat!(
        "SELECT ",
        report_columns!(),
        " FROM reports WHERE id = ? AND node_id = ?"
    ))
    .bind(rid)
    .bind(node_id)
    .fetch_optional(db)
    .await?
    .ok_or_else(ApiError::not_found)?;
    let body: Value = serde_json::from_str(body).unwrap_or_else(|_| json!({}));
    let mut out = serde_json::to_value(summary).expect("summary serializes");
    let obj = out.as_object_mut().expect("summary is an object");
    obj.insert(
        "target".into(),
        body.get("target").cloned().unwrap_or_else(|| json!({})),
    );
    obj.insert(
        "checks".into(),
        body.get("checks").cloned().unwrap_or_else(|| json!([])),
    );
    Ok(out)
}

pub async fn list(State(state): State<AppState>, _user: CurrentUser) -> ApiResult<Json<Value>> {
    let now = now();
    let uptime = uptime_24h(&state.db, now).await?;
    let mut nodes = Vec::new();
    for row in all_nodes(&state.db).await? {
        nodes.push(list_item(&state.db, &row, uptime.get(&row.id).copied(), now).await?);
    }
    Ok(Json(json!({ "nodes": nodes })))
}

pub async fn detail(
    State(state): State<AppState>,
    _user: CurrentUser,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    let row = node_row(&state.db, &id).await?;
    Ok(Json(json!({ "node": detail_json(&state.db, &row).await? })))
}

#[derive(Deserialize)]
pub struct CreateIn {
    name: String,
    addr: String,
    node_key: String,
    #[serde(default)]
    labels: BTreeMap<String, String>,
    probe_interval_secs: Option<i64>,
}

pub fn check_name(name: &str) -> ApiResult<String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 64 {
        return Err(ApiError::invalid("name: от 1 до 64 символов"));
    }
    Ok(name.to_owned())
}

/// `host:port` с непустым хостом и портом 1–65535 (имя не резолвится).
pub fn check_addr(addr: &str) -> ApiResult<String> {
    let addr = addr.trim();
    let valid = addr.rsplit_once(':').is_some_and(|(host, port)| {
        let host = host.trim_start_matches('[').trim_end_matches(']');
        !host.is_empty()
            && !host.contains(char::is_whitespace)
            && port.parse::<u16>().is_ok_and(|p| p != 0)
    });
    if valid {
        Ok(addr.to_owned())
    } else {
        Err(ApiError::invalid("addr: ожидается host:port"))
    }
}

pub fn check_node_key(key: &str) -> ApiResult<String> {
    let key = key.trim().to_ascii_lowercase();
    if key.len() == 64 && key.chars().all(|c| c.is_ascii_hexdigit()) {
        Ok(key)
    } else {
        Err(ApiError::invalid(
            "node_key: 64 hex-символа (node_key= из лога ноды)",
        ))
    }
}

fn check_labels(labels: &BTreeMap<String, String>) -> ApiResult<String> {
    if labels.len() > MAX_LABELS {
        return Err(ApiError::invalid(format!("labels: не больше {MAX_LABELS}")));
    }
    for (key, value) in labels {
        let key_ok = !key.is_empty()
            && key.len() <= 63
            && key.chars().all(|c| {
                c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '-' | '_' | '.')
            });
        if !key_ok {
            return Err(ApiError::invalid(format!(
                "labels: ключ `{key}` — a-z, 0-9, `-`, `_`, `.`, до 63 символов"
            )));
        }
        if value.chars().count() > 256 {
            return Err(ApiError::invalid(format!(
                "labels.{key}: значение длиннее 256"
            )));
        }
    }
    Ok(serde_json::to_string(labels).expect("labels serialize"))
}

fn check_interval(secs: i64) -> ApiResult<i64> {
    if (15..=3600).contains(&secs) {
        Ok(secs)
    } else {
        Err(ApiError::invalid("probe_interval_secs: от 15 до 3600"))
    }
}

fn unique_violation(err: &sqlx::Error) -> bool {
    matches!(err, sqlx::Error::Database(db) if db.is_unique_violation())
}

fn spawn_probe(state: &AppState, row: &NodeRow) {
    let (db, prober) = (state.db.clone(), state.prober.clone());
    let (id, addr, key) = (row.id.clone(), row.addr.clone(), row.node_key.clone());
    tokio::spawn(async move {
        if let Err(err) = run_and_record(&db, prober.as_ref(), &id, &addr, &key).await {
            tracing::warn!(node = %id, error = format!("{err:#}"), "first probe failed to record");
        }
    });
}

pub async fn create(
    State(state): State<AppState>,
    user: CurrentUser,
    Json(input): Json<CreateIn>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    user.require(Role::Admin)?;
    let name = check_name(&input.name)?;
    let addr = check_addr(&input.addr)?;
    let node_key = check_node_key(&input.node_key)?;
    let labels = check_labels(&input.labels)?;
    let interval = check_interval(input.probe_interval_secs.unwrap_or(60))?;
    let token = new_token("tmi_");
    let id = new_id();
    let now = now() as i64;
    let inserted = sqlx::query(
        "INSERT INTO nodes (id, name, addr, node_key, labels, ingest_token_hash, probe_interval_secs, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&name)
    .bind(&addr)
    .bind(&node_key)
    .bind(&labels)
    .bind(token_hash(&token))
    .bind(interval)
    .bind(now)
    .bind(now)
    .execute(&state.db)
    .await;
    match inserted {
        Err(err) if unique_violation(&err) => {
            return Err(ApiError::conflict(format!(
                "нода с адресом {addr} уже есть"
            )));
        }
        other => {
            other?;
        }
    }
    audit::record(
        &state.db,
        Actor::User(&user),
        "node.created",
        Some(&name),
        json!({ "node_id": id, "addr": addr }),
    )
    .await?;
    let row = node_row(&state.db, &id).await?;
    spawn_probe(&state, &row);
    Ok((
        StatusCode::CREATED,
        Json(json!({ "node": detail_json(&state.db, &row).await?, "ingest_token": token })),
    ))
}

#[derive(Deserialize)]
pub struct UpdateIn {
    name: Option<String>,
    addr: Option<String>,
    node_key: Option<String>,
    labels: Option<BTreeMap<String, String>>,
    notes: Option<String>,
    probe_interval_secs: Option<i64>,
    paused: Option<bool>,
    /// Профиль лимитов; пустая строка — профиль по умолчанию.
    profile_id: Option<String>,
    /// Переопределения лимитов поверх профиля.
    overrides: Option<crate::desired::Settings>,
    /// TURN-серверы ноды целиком.
    turn_server_ids: Option<Vec<String>>,
}

pub async fn update(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<String>,
    Json(input): Json<UpdateIn>,
) -> ApiResult<Json<Value>> {
    user.require(Role::Admin)?;
    let mut row = node_row(&state.db, &id).await?;
    let mut changed = Vec::new();
    if let Some(name) = &input.name {
        row.name = check_name(name)?;
        changed.push("name");
    }
    let mut reprobe = false;
    if let Some(addr) = &input.addr {
        row.addr = check_addr(addr)?;
        changed.push("addr");
        reprobe = true;
    }
    if let Some(key) = &input.node_key {
        row.node_key = check_node_key(key)?;
        changed.push("node_key");
        reprobe = true;
    }
    if let Some(labels) = &input.labels {
        row.labels = check_labels(labels)?;
        changed.push("labels");
    }
    if let Some(notes) = &input.notes {
        if notes.chars().count() > 4000 {
            return Err(ApiError::invalid("notes: до 4000 символов"));
        }
        row.notes = notes.clone();
        changed.push("notes");
    }
    if let Some(interval) = input.probe_interval_secs {
        row.probe_interval_secs = check_interval(interval)?;
        changed.push("probe_interval_secs");
    }
    if let Some(paused) = input.paused {
        row.paused = paused;
        changed.push("paused");
    }
    if let Some(profile_id) = &input.profile_id {
        let profile = (!profile_id.is_empty()).then_some(profile_id.as_str());
        if let Some(pid) = profile {
            let exists: Option<String> =
                sqlx::query_scalar("SELECT id FROM limit_profiles WHERE id = ?")
                    .bind(pid)
                    .fetch_optional(&state.db)
                    .await?;
            if exists.is_none() {
                return Err(ApiError::invalid(format!("profile_id: профиля {pid} нет")));
            }
        }
        sqlx::query("UPDATE nodes SET profile_id = ? WHERE id = ?")
            .bind(profile)
            .bind(&id)
            .execute(&state.db)
            .await?;
        changed.push("profile_id");
    }
    if let Some(overrides) = &input.overrides {
        crate::desired::check_settings(overrides).map_err(ApiError::invalid)?;
        sqlx::query("UPDATE nodes SET overrides = ? WHERE id = ?")
            .bind(serde_json::to_string(overrides).expect("overrides serialize"))
            .bind(&id)
            .execute(&state.db)
            .await?;
        changed.push("overrides");
    }
    if let Some(ids) = &input.turn_server_ids {
        super::agents::set_turn_servers(&state, &id, ids).await?;
        changed.push("turn_server_ids");
    }
    let updated = sqlx::query(
        "UPDATE nodes SET name = ?, addr = ?, node_key = ?, labels = ?, notes = ?,
                          probe_interval_secs = ?, paused = ?, updated_at = ?
         WHERE id = ?",
    )
    .bind(&row.name)
    .bind(&row.addr)
    .bind(&row.node_key)
    .bind(&row.labels)
    .bind(&row.notes)
    .bind(row.probe_interval_secs)
    .bind(row.paused)
    .bind(now() as i64)
    .bind(&id)
    .execute(&state.db)
    .await;
    match updated {
        Err(err) if unique_violation(&err) => {
            return Err(ApiError::conflict(format!(
                "нода с адресом {} уже есть",
                row.addr
            )));
        }
        other => {
            other?;
        }
    }
    audit::record(
        &state.db,
        Actor::User(&user),
        "node.updated",
        Some(&row.name),
        json!({ "node_id": id, "fields": changed }),
    )
    .await?;
    let row = node_row(&state.db, &id).await?;
    if reprobe && !row.paused {
        spawn_probe(&state, &row);
    }
    Ok(Json(json!({ "node": detail_json(&state.db, &row).await? })))
}

pub async fn remove(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<String>,
) -> ApiResult<StatusCode> {
    user.require(Role::Admin)?;
    let row = node_row(&state.db, &id).await?;
    sqlx::query("DELETE FROM nodes WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await?;
    audit::record(
        &state.db,
        Actor::User(&user),
        "node.deleted",
        Some(&row.name),
        json!({ "node_id": id, "addr": row.addr }),
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn probe_now(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    user.require(Role::Admin)?;
    let row = node_row(&state.db, &id).await?;
    if row.node_key.is_empty() {
        return Err(ApiError::conflict(
            "ключ ноды ещё неизвестен: его сообщит агент после установки",
        ));
    }
    let (probe_id, _, _) = run_and_record(
        &state.db,
        state.prober.as_ref(),
        &row.id,
        &row.addr,
        &row.node_key,
    )
    .await?;
    let probe: ProbeOut = sqlx::query_as::<_, ProbeRow>(concat!(
        "SELECT ",
        probe_columns!(),
        " FROM probes WHERE id = ?"
    ))
    .bind(&probe_id)
    .fetch_one(&state.db)
    .await?
    .into();
    Ok(Json(json!({ "probe": probe })))
}

#[derive(Deserialize)]
pub struct ProbesQuery {
    since: Option<i64>,
    limit: Option<i64>,
}

pub async fn probes(
    State(state): State<AppState>,
    _user: CurrentUser,
    Path(id): Path<String>,
    Query(q): Query<ProbesQuery>,
) -> ApiResult<Json<Value>> {
    node_row(&state.db, &id).await?;
    let since = q.since.unwrap_or(now() as i64 - 86_400);
    let limit = q.limit.unwrap_or(2000).clamp(1, 5000);
    // Последние `limit` проб после `since`, по возрастанию времени.
    let rows: Vec<ProbeRow> = sqlx::query_as(concat!(
        "SELECT * FROM (
             SELECT ",
        probe_columns!(),
        " FROM probes WHERE node_id = ? AND at >= ?
             ORDER BY at DESC, id DESC LIMIT ?
         ) ORDER BY at, id"
    ))
    .bind(&id)
    .bind(since)
    .bind(limit)
    .fetch_all(&state.db)
    .await?;
    let probes: Vec<ProbeOut> = rows.into_iter().map(Into::into).collect();
    Ok(Json(json!({ "probes": probes })))
}

#[derive(Deserialize)]
pub struct LimitQuery {
    limit: Option<i64>,
}

pub async fn reports(
    State(state): State<AppState>,
    _user: CurrentUser,
    Path(id): Path<String>,
    Query(q): Query<LimitQuery>,
) -> ApiResult<Json<Value>> {
    node_row(&state.db, &id).await?;
    let reports: Vec<ReportSummary> = sqlx::query_as(concat!(
        "SELECT ",
        report_columns!(),
        " FROM reports WHERE node_id = ? ORDER BY received_at DESC, id DESC LIMIT ?"
    ))
    .bind(&id)
    .bind(q.limit.unwrap_or(50).clamp(1, 500))
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({ "reports": reports })))
}

pub async fn report(
    State(state): State<AppState>,
    _user: CurrentUser,
    Path((id, rid)): Path<(String, String)>,
) -> ApiResult<Json<Value>> {
    let body: String = sqlx::query_scalar("SELECT body FROM reports WHERE id = ? AND node_id = ?")
        .bind(&rid)
        .bind(&id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(ApiError::not_found)?;
    Ok(Json(
        json!({ "report": full_report(&state.db, &id, &rid, &body).await? }),
    ))
}

pub async fn rotate_token(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    user.require(Role::Admin)?;
    let row = node_row(&state.db, &id).await?;
    let token = new_token("tmi_");
    sqlx::query("UPDATE nodes SET ingest_token_hash = ?, updated_at = ? WHERE id = ?")
        .bind(token_hash(&token))
        .bind(now() as i64)
        .bind(&id)
        .execute(&state.db)
        .await?;
    audit::record(
        &state.db,
        Actor::User(&user),
        "node.token_rotated",
        Some(&row.name),
        json!({ "node_id": id }),
    )
    .await?;
    Ok(Json(json!({ "ingest_token": token })))
}

/// Статус ноды для сводки — тот же, что в списке.
pub fn status_of(item: &Value) -> NodeStatus {
    item.get("status")
        .and_then(Value::as_str)
        .map(NodeStatus::parse)
        .unwrap_or(NodeStatus::Unknown)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validation() {
        assert_eq!(
            check_addr(" 203.0.113.10:18081 ").unwrap(),
            "203.0.113.10:18081"
        );
        assert!(check_addr("[2001:db8::1]:1").is_ok());
        for bad in ["host", ":1", "host:0", "host:x", "a b:1"] {
            assert!(check_addr(bad).is_err(), "{bad}");
        }
        let key = "AB".repeat(32);
        assert_eq!(check_node_key(&key).unwrap(), "ab".repeat(32));
        assert!(check_node_key("ab").is_err());
        assert!(check_node_key(&"zz".repeat(32)).is_err());
        assert!(check_name("  ").is_err());
        assert!(check_name(&"я".repeat(65)).is_err());
        assert!(check_interval(14).is_err() && check_interval(3601).is_err());
        let mut labels = BTreeMap::new();
        labels.insert("Team".to_owned(), "x".to_owned());
        assert!(check_labels(&labels).is_err());
        labels.clear();
        labels.insert("team".to_owned(), "x".repeat(257));
        assert!(check_labels(&labels).is_err());
        let many: BTreeMap<String, String> =
            (0..33).map(|i| (format!("k{i}"), String::new())).collect();
        assert!(check_labels(&many).is_err());
    }

    #[test]
    fn fingerprint_groups_by_four() {
        assert_eq!(fingerprint("005bdc6b8a95"), "005B-DC6B-8A95");
    }
}
