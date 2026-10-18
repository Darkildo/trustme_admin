//! Журнал действий.

use axum::Json;
use axum::extract::{Query, State};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::AppState;
use crate::auth::{CurrentUser, Role};
use crate::error::ApiResult;

#[derive(sqlx::FromRow)]
struct AuditRow {
    id: String,
    at: i64,
    username: Option<String>,
    action: String,
    target: Option<String>,
    details: String,
    ip: Option<String>,
}

#[derive(Deserialize)]
pub struct AuditQuery {
    limit: Option<i64>,
    before: Option<i64>,
}

pub async fn list(
    State(state): State<AppState>,
    user: CurrentUser,
    Query(q): Query<AuditQuery>,
) -> ApiResult<Json<Value>> {
    user.require(Role::Admin)?;
    let rows: Vec<AuditRow> = sqlx::query_as(
        "SELECT id, at, username, action, target, details, ip FROM audit
             WHERE at < ? ORDER BY at DESC, id DESC LIMIT ?",
    )
    .bind(q.before.unwrap_or(i64::MAX))
    .bind(q.limit.unwrap_or(100).clamp(1, 500))
    .fetch_all(&state.db)
    .await?;
    let entries: Vec<Value> = rows
        .into_iter()
        .map(|r| {
            json!({
                "id": r.id, "at": r.at, "user": r.username, "action": r.action, "target": r.target,
                "details": serde_json::from_str::<Value>(&r.details).unwrap_or_else(|_| json!({})),
                "ip": r.ip,
            })
        })
        .collect();
    Ok(Json(json!({ "entries": entries })))
}
