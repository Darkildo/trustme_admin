//! Первичная настройка: первый владелец по одноразовой ссылке из лога.

use axum::Json;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use serde_json::json;
use sqlx::SqlitePool;

use super::{check_password, check_username, load_user};
use crate::audit::{self, Actor};
use crate::auth::{ClientIp, start_session};
use crate::crypto::{hash_password, new_token, token_hash};
use crate::error::{ApiError, ApiResult};
use crate::{AppState, new_id, now};

/// Срок ссылки первичной настройки.
const SETUP_TOKEN_SECS: u64 = 24 * 3600;

async fn setup_needed(db: &SqlitePool) -> sqlx::Result<bool> {
    let users: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(db)
        .await?;
    Ok(users == 0)
}

/// Если пользователей нет — выпустить новый токен настройки (прежние
/// гаснут) и вернуть его для ссылки в логе.
pub async fn ensure_setup_token(db: &SqlitePool) -> sqlx::Result<Option<String>> {
    if !setup_needed(db).await? {
        return Ok(None);
    }
    let token = new_token("tmo_");
    sqlx::query("DELETE FROM one_time_tokens WHERE kind = 'setup'")
        .execute(db)
        .await?;
    sqlx::query(
        "INSERT INTO one_time_tokens (token_hash, kind, expires_at) VALUES (?, 'setup', ?)",
    )
    .bind(token_hash(&token))
    .bind((now() + SETUP_TOKEN_SECS) as i64)
    .execute(db)
    .await?;
    Ok(Some(token))
}

pub async fn status(State(state): State<AppState>) -> ApiResult<Json<serde_json::Value>> {
    Ok(Json(json!({ "needed": setup_needed(&state.db).await? })))
}

#[derive(Deserialize)]
pub struct SetupIn {
    token: String,
    username: String,
    password: String,
}

pub async fn complete(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    headers: HeaderMap,
    Json(input): Json<SetupIn>,
) -> ApiResult<Response> {
    if !setup_needed(&state.db).await? {
        return Err(ApiError::conflict("настройка уже проведена"));
    }
    let valid: Option<i64> = sqlx::query_scalar(
        "SELECT expires_at FROM one_time_tokens WHERE token_hash = ? AND kind = 'setup' AND expires_at > ?",
    )
    .bind(token_hash(&input.token))
    .bind(now() as i64)
    .fetch_optional(&state.db)
    .await?;
    if valid.is_none() {
        return Err(ApiError::forbidden(
            "ссылка настройки неверна или истекла — перезапустите сервер, он выпустит новую",
        ));
    }
    let username = input.username.trim();
    check_username(username)?;
    check_password(&input.password)?;

    let id = new_id();
    let hash = hash_password(&input.password)?;
    let mut tx = state.db.begin().await?;
    sqlx::query(
        "INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, 'owner', ?)",
    )
    .bind(&id)
    .bind(username)
    .bind(hash)
    .bind(now() as i64)
    .execute(&mut *tx)
    .await?;
    sqlx::query("DELETE FROM one_time_tokens WHERE kind = 'setup'")
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    audit::record(
        &state.db,
        Actor::Named {
            id: Some(&id),
            username,
            ip: ip.as_deref(),
        },
        "setup.completed",
        Some(username),
        json!({}),
    )
    .await?;
    let cookie = start_session(&state, &id, &headers, ip.as_deref()).await?;
    let user = load_user(&state.db, &id).await?;
    Ok((
        StatusCode::CREATED,
        [(header::SET_COOKIE, cookie)],
        Json(json!({ "user": user })),
    )
        .into_response())
}
