//! Обновление ноды и агента `tmnode` из панели (trustme_backend:
//! docs/agent-protocol.md, «Обновление»).
//!
//! Администратор выбирает версию релиза бэкенда, панель заводит задание.
//! Агент забирает его в ответе heartbeat и присылает ход в следующих:
//! `running` → итог. Откуда качать образ и бинарь, агент решает сам; панель
//! называет только версии и хэш бинаря из `SHA256SUMS` релиза.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::SqlitePool;

use super::agents::INSTALL_SCRIPT;
use crate::audit::{self, Actor};
use crate::auth::{CurrentUser, Role};
use crate::error::{ApiError, ApiResult};
use crate::releases::{ARCHES, Version, image_version};
use crate::{AppState, new_lower_id, now};

/// С этой версии агент выполняет задания на обновление.
pub const MIN_AGENT: Version = Version::new(0, 3, 0);
/// `running`, по которому агент не присылал статуса дольше этого, — `lost`.
pub const LOST_AFTER_SECS: u64 = 15 * 60;
/// Сколько заданий показывать в истории ноды.
const HISTORY_LIMIT: i64 = 50;

/// Команда, которой агент до 0.3.0 обновляют на самом сервере.
pub fn agent_upgrade_command() -> String {
    format!("curl -fsSL {INSTALL_SCRIPT} | sudo sh -s -- agent-upgrade")
}

/// Задание на обновление.
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct UpdateRow {
    pub id: String,
    pub node_id: String,
    pub node_version: Option<String>,
    pub tmnode_version: Option<String>,
    pub tmnode_sha256: Option<String>,
    pub allow_downgrade: bool,
    pub state: String,
    pub step: Option<String>,
    pub error: Option<String>,
    pub from_node_image: Option<String>,
    pub to_node_image: Option<String>,
    pub from_tmnode: Option<String>,
    pub to_tmnode: Option<String>,
    pub created_by: Option<String>,
    pub created_at: i64,
    pub started_at: Option<i64>,
    pub finished_at: Option<i64>,
    pub reported_at: Option<i64>,
}

macro_rules! update_columns {
    () => {
        "id, node_id, node_version, tmnode_version, tmnode_sha256, allow_downgrade, state, step, \
         error, from_node_image, to_node_image, from_tmnode, to_tmnode, created_by, created_at, \
         started_at, finished_at, reported_at"
    };
}

async fn active(db: &SqlitePool, node_id: &str) -> sqlx::Result<Option<UpdateRow>> {
    sqlx::query_as::<_, UpdateRow>(concat!(
        "SELECT ",
        update_columns!(),
        " FROM node_updates WHERE node_id = ? AND state IN ('pending', 'running')"
    ))
    .bind(node_id)
    .fetch_optional(db)
    .await
}

async fn by_id(db: &SqlitePool, id: &str) -> sqlx::Result<Option<UpdateRow>> {
    sqlx::query_as::<_, UpdateRow>(concat!(
        "SELECT ",
        update_columns!(),
        " FROM node_updates WHERE id = ?"
    ))
    .bind(id)
    .fetch_optional(db)
    .await
}

async fn node_name(db: &SqlitePool, node_id: &str) -> sqlx::Result<String> {
    Ok(sqlx::query_scalar("SELECT name FROM nodes WHERE id = ?")
        .bind(node_id)
        .fetch_optional(db)
        .await?
        .unwrap_or_else(|| node_id.to_owned()))
}

/// Пометить потерянными задания, по которым агент молчит дольше
/// [`LOST_AFTER_SECS`]. Вызывается при чтении и раз в час.
pub async fn mark_lost(db: &SqlitePool, now: u64) -> sqlx::Result<()> {
    let lost: Vec<(String, String, Option<String>)> = sqlx::query_as(
        "UPDATE node_updates SET state = 'lost', finished_at = ?, error = ?
         WHERE state = 'running' AND COALESCE(reported_at, started_at, created_at) < ?
         RETURNING id, node_id, step",
    )
    .bind(now as i64)
    .bind(format!(
        "агент не присылал ход обновления {} минут: проверьте службу tmnode-agent на сервере",
        LOST_AFTER_SECS / 60
    ))
    .bind(now.saturating_sub(LOST_AFTER_SECS) as i64)
    .fetch_all(db)
    .await?;
    for (id, node_id, step) in lost {
        tracing::warn!(node = %node_id, update = %id, "node update is lost");
        audit::record(
            db,
            Actor::Named {
                id: None,
                username: "system",
                ip: None,
            },
            "node.update_finished",
            Some(&node_name(db, &node_id).await?),
            json!({ "node_id": node_id, "update_id": id, "state": "lost", "step": step }),
        )
        .await?;
    }
    Ok(())
}

/// Агент ноды и его версии.
struct Current {
    managed: bool,
    agent: Option<AgentRow>,
    node_image: Option<String>,
    image_source: Option<&'static str>,
}

#[derive(sqlx::FromRow)]
struct AgentRow {
    arch: String,
    tmnode_version: String,
    node_image: Option<String>,
}

impl Current {
    fn node_version(&self) -> Option<Version> {
        self.node_image.as_deref().and_then(image_version)
    }

    fn tmnode_version(&self) -> Option<Version> {
        self.agent
            .as_ref()
            .and_then(|a| Version::parse_lenient(&a.tmnode_version))
    }

    fn supports_updates(&self) -> bool {
        self.managed && self.tmnode_version().is_some_and(|v| v >= MIN_AGENT)
    }

    fn json(&self) -> Value {
        json!({
            "managed": self.managed,
            "agent": self.agent.as_ref().map(|a| json!({ "arch": a.arch, "tmnode_version": a.tmnode_version })),
            "node_image": self.node_image,
            "node_image_source": self.image_source,
            "node_version": self.node_version(),
            "tmnode_version": self.agent.as_ref().map(|a| a.tmnode_version.clone()),
            "supports_updates": self.supports_updates(),
            "min_agent_version": MIN_AGENT,
            "agent_upgrade_command": agent_upgrade_command(),
        })
    }
}

/// Образ ноды из последнего отчёта: `runtime.container` → `data.image`.
async fn report_image(db: &SqlitePool, node_id: &str) -> sqlx::Result<Option<String>> {
    let body: Option<String> = sqlx::query_scalar(
        "SELECT body FROM reports WHERE node_id = ? ORDER BY received_at DESC, id DESC LIMIT 1",
    )
    .bind(node_id)
    .fetch_optional(db)
    .await?;
    let body: Option<Value> = body.and_then(|b| serde_json::from_str(&b).ok());
    Ok(body.and_then(|b| {
        b["checks"]
            .as_array()?
            .iter()
            .find(|c| c["id"] == "runtime.container")?["data"]["image"]
            .as_str()
            .map(str::to_owned)
    }))
}

async fn current(db: &SqlitePool, node_id: &str) -> ApiResult<Current> {
    let provision: Option<Option<String>> =
        sqlx::query_scalar("SELECT provision FROM nodes WHERE id = ?")
            .bind(node_id)
            .fetch_optional(db)
            .await?;
    let managed = provision.ok_or_else(ApiError::not_found)?.is_some();
    let agent: Option<AgentRow> =
        sqlx::query_as("SELECT arch, tmnode_version, node_image FROM agents WHERE node_id = ?")
            .bind(node_id)
            .fetch_optional(db)
            .await?;
    let (node_image, image_source) = match agent.as_ref().and_then(|a| a.node_image.clone()) {
        Some(image) => (Some(image), Some("agent")),
        None => match report_image(db, node_id).await? {
            Some(image) => (Some(image), Some("report")),
            None => (None, None),
        },
    };
    Ok(Current {
        managed,
        agent,
        node_image,
        image_source,
    })
}

/// `GET /releases` — выпущенные версии бэкенда.
pub async fn releases(State(state): State<AppState>, _user: CurrentUser) -> ApiResult<Json<Value>> {
    if !state.releases.enabled() {
        return Ok(Json(
            json!({ "enabled": false, "repo": null, "latest": null, "releases": [] }),
        ));
    }
    let list = state
        .releases
        .list()
        .await
        .map_err(|e| ApiError::unavailable(format!("релизы недоступны: {e}")))?;
    let releases: Vec<Value> = list
        .iter()
        .map(|r| {
            let tmnode: serde_json::Map<String, Value> = ARCHES
                .iter()
                .map(|arch| ((*arch).to_owned(), json!(r.has_tmnode(arch))))
                .collect();
            json!({
                "version": r.version, "tag": r.tag, "published_at": r.published_at,
                "url": r.url, "tmnode": tmnode,
            })
        })
        .collect();
    Ok(Json(json!({
        "enabled": true,
        "repo": state.releases.repo(),
        "latest": list.first().map(|r| r.version),
        "releases": releases,
    })))
}

/// `GET /nodes/{id}/updates` — версии ноды и история обновлений.
pub async fn history(
    State(state): State<AppState>,
    _user: CurrentUser,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    mark_lost(&state.db, now()).await?;
    let current = current(&state.db, &id).await?;
    let updates: Vec<UpdateRow> = sqlx::query_as(concat!(
        "SELECT ",
        update_columns!(),
        " FROM node_updates WHERE node_id = ? ORDER BY created_at DESC, id DESC LIMIT ?"
    ))
    .bind(&id)
    .bind(HISTORY_LIMIT)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(
        json!({ "current": current.json(), "updates": updates }),
    ))
}

#[derive(Deserialize)]
pub struct CreateIn {
    node_version: Option<String>,
    tmnode_version: Option<String>,
    /// Только когда релизы выключены: хэш `tmnode-<arch>-linux` вручную.
    tmnode_sha256: Option<String>,
    #[serde(default)]
    allow_downgrade: bool,
}

fn parse_version(field: &str, value: Option<&str>) -> ApiResult<Option<Version>> {
    match value.map(str::trim).filter(|v| !v.is_empty()) {
        None => Ok(None),
        Some(v) => Version::parse(v)
            .map(Some)
            .ok_or_else(|| ApiError::invalid(format!("{field}: ожидается X.Y.Z"))),
    }
}

/// `POST /nodes/{id}/update` — завести задание на обновление.
pub async fn create(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<String>,
    Json(input): Json<CreateIn>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    user.require(Role::Admin)?;
    let now = now();
    mark_lost(&state.db, now).await?;
    let current = current(&state.db, &id).await?;
    if !current.managed {
        return Err(ApiError::conflict(
            "нода добавлена по адресу и пину: её ставили без админки, обновляют её на сервере",
        ));
    }
    let Some(agent) = &current.agent else {
        return Err(ApiError::conflict(
            "агент tmnode ещё не подключился: обновлять ноду некому",
        ));
    };
    if !current.supports_updates() {
        return Err(ApiError::conflict(format!(
            "агент tmnode {} не умеет обновляться из панели (нужен {MIN_AGENT} или новее). \
             Обновите его на сервере: {}",
            agent.tmnode_version,
            agent_upgrade_command()
        )));
    }
    let node_version = parse_version("node_version", input.node_version.as_deref())?;
    let tmnode_version = parse_version("tmnode_version", input.tmnode_version.as_deref())?;
    if node_version.is_none() && tmnode_version.is_none() {
        return Err(ApiError::invalid(
            "нужна node_version, tmnode_version или обе",
        ));
    }
    if let Some(v) = tmnode_version
        && v < MIN_AGENT
    {
        // Такой агент не знает заданий: обновление зависло бы до lost.
        return Err(ApiError::unprocessable(format!(
            "tmnode {v} не умеет обновляться из панели: нужен {MIN_AGENT} или новее"
        )));
    }
    if !input.allow_downgrade {
        let lower = |want: Option<Version>, have: Option<Version>| {
            want.zip(have).filter(|(w, h)| w < h).map(|(_, h)| h)
        };
        if let Some(have) = lower(node_version, current.node_version()) {
            return Err(ApiError::unprocessable(format!(
                "нода {have} новее выбранной версии: понижение — только с allow_downgrade"
            )));
        }
        if let Some(have) = lower(tmnode_version, current.tmnode_version()) {
            return Err(ApiError::unprocessable(format!(
                "tmnode {have} новее выбранной версии: понижение — только с allow_downgrade"
            )));
        }
    }
    if active(&state.db, &id).await?.is_some() {
        return Err(ApiError::conflict(
            "у ноды уже есть незавершённое обновление",
        ));
    }

    let manual_sha = match input.tmnode_sha256.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(sha) if sha.len() == 64 && sha.bytes().all(|b| b.is_ascii_hexdigit()) => {
            Some(sha.to_ascii_lowercase())
        }
        Some(_) => return Err(ApiError::invalid("tmnode_sha256: 64 hex-символа")),
    };
    let tmnode_sha256 = match tmnode_version {
        None => None,
        Some(v) if state.releases.enabled() => {
            if !ARCHES.contains(&agent.arch.as_str()) {
                return Err(ApiError::unprocessable(format!(
                    "tmnode под архитектуру {} не выпускается",
                    agent.arch
                )));
            }
            let release = find_release(&state, v).await?;
            let sha = state
                .releases
                .tmnode_sha256(&release, &agent.arch)
                .await
                .map_err(|e| ApiError::unavailable(format!("SHA256SUMS недоступен: {e}")))?
                .ok_or_else(|| {
                    ApiError::unprocessable(format!(
                        "в релизе {} нет tmnode под {}",
                        release.tag, agent.arch
                    ))
                })?;
            if manual_sha.as_ref().is_some_and(|m| *m != sha) {
                return Err(ApiError::unprocessable(
                    "tmnode_sha256 не совпадает с SHA256SUMS релиза",
                ));
            }
            Some(sha)
        }
        Some(_) => Some(manual_sha.ok_or_else(|| {
            ApiError::invalid(format!(
                "релизы выключены: нужен tmnode_sha256 — хэш tmnode-{}-linux из SHA256SUMS релиза",
                agent.arch
            ))
        })?),
    };
    if let Some(v) = node_version
        && state.releases.enabled()
    {
        find_release(&state, v).await?;
    }

    let update_id = new_lower_id();
    let inserted = sqlx::query(
        "INSERT INTO node_updates (id, node_id, node_version, tmnode_version, tmnode_sha256,
                                   allow_downgrade, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&update_id)
    .bind(&id)
    .bind(node_version.map(|v| v.to_string()))
    .bind(tmnode_version.map(|v| v.to_string()))
    .bind(&tmnode_sha256)
    .bind(input.allow_downgrade)
    .bind(&user.username)
    .bind(now as i64)
    .execute(&state.db)
    .await;
    if let Err(sqlx::Error::Database(err)) = &inserted
        && err.is_unique_violation()
    {
        return Err(ApiError::conflict(
            "у ноды уже есть незавершённое обновление",
        ));
    }
    inserted?;
    audit::record(
        &state.db,
        Actor::User(&user),
        "node.update_created",
        Some(&node_name(&state.db, &id).await?),
        json!({
            "node_id": id, "update_id": update_id,
            "node_version": node_version, "tmnode_version": tmnode_version,
            "allow_downgrade": input.allow_downgrade,
            "from_node_image": current.node_image,
            "from_tmnode": agent.tmnode_version,
        }),
    )
    .await?;
    let row = by_id(&state.db, &update_id)
        .await?
        .ok_or_else(ApiError::internal)?;
    Ok((StatusCode::CREATED, Json(json!({ "update": row }))))
}

async fn find_release(state: &AppState, version: Version) -> ApiResult<crate::releases::Release> {
    state
        .releases
        .find(version)
        .await
        .map_err(|e| ApiError::unavailable(format!("релизы недоступны: {e}")))?
        .ok_or_else(|| {
            ApiError::unprocessable(format!(
                "релиза v{version} нет среди выпущенных в {}",
                state.releases.repo().unwrap_or("репозитории")
            ))
        })
}

/// `POST /nodes/{id}/updates/{uid}/cancel` — отменить, пока агент не начал.
pub async fn cancel(
    State(state): State<AppState>,
    user: CurrentUser,
    Path((id, uid)): Path<(String, String)>,
) -> ApiResult<Json<Value>> {
    user.require(Role::Admin)?;
    let uid = uid.to_ascii_lowercase();
    let cancelled = sqlx::query(
        "UPDATE node_updates SET state = 'cancelled', finished_at = ?
         WHERE id = ? AND node_id = ? AND state = 'pending'",
    )
    .bind(now() as i64)
    .bind(&uid)
    .bind(&id)
    .execute(&state.db)
    .await?;
    let row = by_id(&state.db, &uid)
        .await?
        .filter(|r| r.node_id == id)
        .ok_or_else(ApiError::not_found)?;
    if cancelled.rows_affected() == 0 {
        return Err(ApiError::conflict(match row.state.as_str() {
            "running" => "агент уже начал обновление — отменить его нельзя".to_owned(),
            other => format!("задание уже завершено ({other})"),
        }));
    }
    audit::record(
        &state.db,
        Actor::User(&user),
        "node.update_cancelled",
        Some(&node_name(&state.db, &id).await?),
        json!({ "node_id": id, "update_id": uid }),
    )
    .await?;
    Ok(Json(json!({ "update": row })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upgrade_command_uses_the_stable_installer() {
        assert!(agent_upgrade_command().ends_with("| sudo sh -s -- agent-upgrade"));
        assert!(agent_upgrade_command().contains("/stable/deploy/install.sh"));
    }
}
