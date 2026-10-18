//! Пользователи панели: приглашения, роли, блокировка.

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use serde_json::{Value, json};

use super::{UserOut, check_password, check_username, load_user, user_columns};
use crate::audit::{self, Actor};
use crate::auth::{ClientIp, CurrentUser, Role, start_session};
use crate::crypto::{hash_password, new_token, token_hash};
use crate::error::{ApiError, ApiResult};
use crate::{AppState, new_id, now};

const INVITE_SECS: u64 = 48 * 3600;

pub async fn list(State(state): State<AppState>, user: CurrentUser) -> ApiResult<Json<Value>> {
    user.require(Role::Owner)?;
    let users: Vec<UserOut> = sqlx::query_as(concat!(
        "SELECT ",
        user_columns!(),
        " FROM users ORDER BY created_at, id"
    ))
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({ "users": users })))
}

#[derive(Deserialize)]
pub struct InviteIn {
    username: String,
    role: String,
}

pub async fn invite(
    State(state): State<AppState>,
    user: CurrentUser,
    Json(input): Json<InviteIn>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    user.require(Role::Owner)?;
    let username = input.username.trim();
    check_username(username)?;
    let role = Role::parse(&input.role)
        .ok_or_else(|| ApiError::invalid("role: owner, admin или viewer"))?;
    let id = new_id();
    let inserted =
        sqlx::query("INSERT INTO users (id, username, role, created_at) VALUES (?, ?, ?, ?)")
            .bind(&id)
            .bind(username)
            .bind(role.as_str())
            .bind(now() as i64)
            .execute(&state.db)
            .await;
    if let Err(sqlx::Error::Database(err)) = &inserted
        && err.is_unique_violation()
    {
        return Err(ApiError::conflict(format!(
            "пользователь {username} уже есть"
        )));
    }
    inserted?;
    let token = new_token("tmo_");
    sqlx::query(
        "INSERT INTO one_time_tokens (token_hash, kind, user_id, expires_at) VALUES (?, 'invite', ?, ?)",
    )
    .bind(token_hash(&token))
    .bind(&id)
    .bind((now() + INVITE_SECS) as i64)
    .execute(&state.db)
    .await?;
    audit::record(
        &state.db,
        Actor::User(&user),
        "user.invited",
        Some(username),
        json!({ "role": role.as_str() }),
    )
    .await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({
            "user": load_user(&state.db, &id).await?,
            "invite_url": format!("/invite?token={token}"),
        })),
    ))
}

async fn invitee(state: &AppState, token: &str) -> ApiResult<(String, String)> {
    sqlx::query_as(
        "SELECT u.id, u.username FROM one_time_tokens t JOIN users u ON u.id = t.user_id
         WHERE t.token_hash = ? AND t.kind = 'invite' AND t.expires_at > ? AND u.disabled = 0",
    )
    .bind(token_hash(token))
    .bind(now() as i64)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(ApiError::not_found)
}

#[derive(Deserialize)]
pub struct TokenQuery {
    token: String,
}

pub async fn invite_info(
    State(state): State<AppState>,
    Query(q): Query<TokenQuery>,
) -> ApiResult<Json<Value>> {
    let (_, username) = invitee(&state, &q.token).await?;
    Ok(Json(json!({ "username": username })))
}

#[derive(Deserialize)]
pub struct AcceptIn {
    token: String,
    password: String,
}

pub async fn accept_invite(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    headers: HeaderMap,
    Json(input): Json<AcceptIn>,
) -> ApiResult<Response> {
    let (id, username) = invitee(&state, &input.token).await?;
    check_password(&input.password)?;
    sqlx::query("UPDATE users SET password_hash = ? WHERE id = ?")
        .bind(hash_password(&input.password)?)
        .bind(&id)
        .execute(&state.db)
        .await?;
    sqlx::query("DELETE FROM one_time_tokens WHERE user_id = ? AND kind = 'invite'")
        .bind(&id)
        .execute(&state.db)
        .await?;
    audit::record(
        &state.db,
        Actor::Named {
            id: Some(&id),
            username: &username,
            ip: ip.as_deref(),
        },
        "user.activated",
        Some(&username),
        json!({}),
    )
    .await?;
    let cookie = start_session(&state, &id, &headers, ip.as_deref()).await?;
    let user = load_user(&state.db, &id).await?;
    Ok((
        [(header::SET_COOKIE, cookie)],
        Json(json!({ "user": user })),
    )
        .into_response())
}

async fn active_owners(state: &AppState) -> sqlx::Result<i64> {
    sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE role = 'owner' AND disabled = 0")
        .fetch_one(&state.db)
        .await
}

#[derive(Deserialize)]
pub struct UpdateIn {
    role: Option<String>,
    disabled: Option<bool>,
}

pub async fn update(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<String>,
    Json(input): Json<UpdateIn>,
) -> ApiResult<Json<Value>> {
    user.require(Role::Owner)?;
    let target = load_user(&state.db, &id).await?;
    let role = match &input.role {
        Some(r) => {
            Some(Role::parse(r).ok_or_else(|| ApiError::invalid("role: owner, admin или viewer"))?)
        }
        None => None,
    };
    let demotes = role.is_some_and(|r| r != Role::Owner) || input.disabled == Some(true);
    if target.role == "owner" && !target.disabled && demotes && active_owners(&state).await? <= 1 {
        return Err(ApiError::conflict(
            "нельзя понизить или заблокировать последнего владельца",
        ));
    }
    if let Some(role) = role {
        sqlx::query("UPDATE users SET role = ? WHERE id = ?")
            .bind(role.as_str())
            .bind(&id)
            .execute(&state.db)
            .await?;
    }
    if let Some(disabled) = input.disabled {
        sqlx::query("UPDATE users SET disabled = ? WHERE id = ?")
            .bind(disabled)
            .bind(&id)
            .execute(&state.db)
            .await?;
        if disabled {
            sqlx::query("DELETE FROM sessions WHERE user_id = ?")
                .bind(&id)
                .execute(&state.db)
                .await?;
        }
    }
    audit::record(
        &state.db,
        Actor::User(&user),
        "user.updated",
        Some(&target.username),
        json!({ "role": input.role, "disabled": input.disabled }),
    )
    .await?;
    Ok(Json(json!({ "user": load_user(&state.db, &id).await? })))
}

pub async fn remove(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<String>,
) -> ApiResult<StatusCode> {
    user.require(Role::Owner)?;
    if id == user.id {
        return Err(ApiError::conflict("нельзя удалить себя"));
    }
    let target = load_user(&state.db, &id).await?;
    if target.role == "owner" && !target.disabled && active_owners(&state).await? <= 1 {
        return Err(ApiError::conflict("нельзя удалить последнего владельца"));
    }
    sqlx::query("DELETE FROM users WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await?;
    audit::record(
        &state.db,
        Actor::User(&user),
        "user.deleted",
        Some(&target.username),
        json!({}),
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}
