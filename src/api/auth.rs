//! Вход, выход, TOTP, смена пароля.

use std::sync::OnceLock;

use axum::Json;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use serde_json::{Value, json};

use super::{check_password, load_user};
use crate::audit::{self, Actor};
use crate::auth::{
    ClientIp, CurrentUser, check_totp, new_totp_secret, session_clear_cookie, start_session, totp,
};
use crate::crypto::{hash_password, verify_password};
use crate::error::{ApiError, ApiResult};
use crate::{AppState, now};

#[derive(sqlx::FromRow)]
struct LoginRow {
    id: String,
    username: String,
    password_hash: Option<String>,
    totp_secret: Option<Vec<u8>>,
    totp_last_step: Option<i64>,
}

#[derive(Deserialize)]
pub struct LoginIn {
    username: String,
    password: String,
    totp: Option<String>,
}

/// Хэш-пустышка: проверка пароля несуществующего пользователя занимает
/// столько же, сколько настоящая, и по времени ответа логины не перебрать.
fn dummy_hash() -> &'static str {
    static HASH: OnceLock<String> = OnceLock::new();
    HASH.get_or_init(|| hash_password("dummy password for timing").expect("argon2"))
}

pub async fn login(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    headers: HeaderMap,
    Json(input): Json<LoginIn>,
) -> ApiResult<Response> {
    let username = input.username.trim().to_owned();
    let now = now();
    if let Err(wait) = state.login_limiter.check(&username, ip.as_deref(), now) {
        return Err(ApiError::rate_limited(wait));
    }

    let row: Option<LoginRow> = sqlx::query_as(
        "SELECT id, username, password_hash, totp_secret, totp_last_step
             FROM users WHERE username = ? AND disabled = 0",
    )
    .bind(&username)
    .fetch_optional(&state.db)
    .await?;

    let password = input.password.clone();
    let hash = row
        .as_ref()
        .and_then(|r| r.password_hash.clone())
        .unwrap_or_else(|| dummy_hash().to_owned());
    let password_ok = tokio::task::spawn_blocking(move || verify_password(&password, &hash))
        .await
        .map_err(|_| ApiError::internal())?
        && row.as_ref().is_some_and(|r| r.password_hash.is_some());

    let fail = |state: &AppState| {
        state.login_limiter.failed(&username, ip.as_deref(), now);
    };
    let Some(LoginRow {
        id,
        username: canonical,
        totp_secret,
        totp_last_step: last_step,
        ..
    }) = row.filter(|_| password_ok)
    else {
        fail(&state);
        audit::record(
            &state.db,
            Actor::Named {
                id: None,
                username: &username,
                ip: ip.as_deref(),
            },
            "auth.login_failed",
            Some(&username),
            json!({ "reason": "password" }),
        )
        .await?;
        return Err(ApiError {
            message: "неверное имя или пароль".into(),
            ..ApiError::unauthorized()
        });
    };

    if let Some(sealed) = totp_secret {
        let Some(code) = input.totp.as_deref().filter(|c| !c.trim().is_empty()) else {
            return Err(ApiError::totp_required());
        };
        let secret = state.secrets.open(&sealed)?;
        let totp = totp(
            std::str::from_utf8(&secret).map_err(|_| ApiError::internal())?,
            &canonical,
        )?;
        let Some(step) = check_totp(&totp, code, last_step, now) else {
            fail(&state);
            audit::record(
                &state.db,
                Actor::Named {
                    id: Some(&id),
                    username: &canonical,
                    ip: ip.as_deref(),
                },
                "auth.login_failed",
                Some(&canonical),
                json!({ "reason": "totp" }),
            )
            .await?;
            return Err(ApiError {
                message: "неверный код".into(),
                ..ApiError::totp_required()
            });
        };
        sqlx::query("UPDATE users SET totp_last_step = ? WHERE id = ?")
            .bind(step)
            .bind(&id)
            .execute(&state.db)
            .await?;
    }

    state.login_limiter.succeeded(&username, ip.as_deref());
    let cookie = start_session(&state, &id, &headers, ip.as_deref()).await?;
    audit::record(
        &state.db,
        Actor::Named {
            id: Some(&id),
            username: &canonical,
            ip: ip.as_deref(),
        },
        "auth.login",
        Some(&canonical),
        json!({}),
    )
    .await?;
    let user = load_user(&state.db, &id).await?;
    Ok((
        [(header::SET_COOKIE, cookie)],
        Json(json!({ "user": user })),
    )
        .into_response())
}

pub async fn logout(State(state): State<AppState>, user: CurrentUser) -> ApiResult<Response> {
    sqlx::query("DELETE FROM sessions WHERE token_hash = ?")
        .bind(&user.session_hash)
        .execute(&state.db)
        .await?;
    audit::record(
        &state.db,
        Actor::User(&user),
        "auth.logout",
        None,
        json!({}),
    )
    .await?;
    Ok((
        StatusCode::NO_CONTENT,
        [(
            header::SET_COOKIE,
            session_clear_cookie(state.secure_cookies),
        )],
    )
        .into_response())
}

pub async fn me(State(state): State<AppState>, user: CurrentUser) -> ApiResult<Json<Value>> {
    Ok(Json(
        json!({ "user": load_user(&state.db, &user.id).await? }),
    ))
}

pub async fn totp_setup(
    State(state): State<AppState>,
    user: CurrentUser,
) -> ApiResult<Json<Value>> {
    let secret = new_totp_secret().to_base32();
    let uri = totp(&secret, &user.username)?
        .to_url()
        .map_err(|_| ApiError::internal())?;
    sqlx::query("UPDATE users SET totp_pending = ? WHERE id = ?")
        .bind(state.secrets.seal(secret.as_bytes()))
        .bind(&user.id)
        .execute(&state.db)
        .await?;
    Ok(Json(json!({ "secret": secret, "otpauth_uri": uri })))
}

#[derive(Deserialize)]
pub struct CodeIn {
    code: String,
}

pub async fn totp_enable(
    State(state): State<AppState>,
    user: CurrentUser,
    Json(input): Json<CodeIn>,
) -> ApiResult<Json<Value>> {
    let pending: Option<Vec<u8>> =
        sqlx::query_scalar("SELECT totp_pending FROM users WHERE id = ?")
            .bind(&user.id)
            .fetch_one(&state.db)
            .await?;
    let sealed =
        pending.ok_or_else(|| ApiError::invalid("сначала получите секрет: /auth/totp/setup"))?;
    let secret = state.secrets.open(&sealed)?;
    let totp = totp(
        std::str::from_utf8(&secret).map_err(|_| ApiError::internal())?,
        &user.username,
    )?;
    let step = check_totp(&totp, &input.code, None, now())
        .ok_or_else(|| ApiError::invalid("неверный код"))?;
    sqlx::query(
        "UPDATE users SET totp_secret = totp_pending, totp_pending = NULL, totp_last_step = ? WHERE id = ?",
    )
    .bind(step)
    .bind(&user.id)
    .execute(&state.db)
    .await?;
    audit::record(
        &state.db,
        Actor::User(&user),
        "auth.totp_enabled",
        None,
        json!({}),
    )
    .await?;
    Ok(Json(
        json!({ "user": load_user(&state.db, &user.id).await? }),
    ))
}

#[derive(Deserialize)]
pub struct DisableIn {
    password: String,
    code: String,
}

pub async fn totp_disable(
    State(state): State<AppState>,
    user: CurrentUser,
    Json(input): Json<DisableIn>,
) -> ApiResult<Json<Value>> {
    let (hash, sealed, last_step): (Option<String>, Option<Vec<u8>>, Option<i64>) =
        sqlx::query_as("SELECT password_hash, totp_secret, totp_last_step FROM users WHERE id = ?")
            .bind(&user.id)
            .fetch_one(&state.db)
            .await?;
    let sealed = sealed.ok_or_else(|| ApiError::invalid("TOTP не включён"))?;
    if !hash.is_some_and(|h| verify_password(&input.password, &h)) {
        return Err(ApiError::invalid("неверный пароль"));
    }
    let secret = state.secrets.open(&sealed)?;
    let totp = totp(
        std::str::from_utf8(&secret).map_err(|_| ApiError::internal())?,
        &user.username,
    )?;
    check_totp(&totp, &input.code, last_step, now())
        .ok_or_else(|| ApiError::invalid("неверный код"))?;
    sqlx::query("UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_last_step = NULL WHERE id = ?")
        .bind(&user.id)
        .execute(&state.db)
        .await?;
    audit::record(
        &state.db,
        Actor::User(&user),
        "auth.totp_disabled",
        None,
        json!({}),
    )
    .await?;
    Ok(Json(
        json!({ "user": load_user(&state.db, &user.id).await? }),
    ))
}

#[derive(Deserialize)]
pub struct PasswordIn {
    current: String,
    new: String,
}

pub async fn change_password(
    State(state): State<AppState>,
    user: CurrentUser,
    Json(input): Json<PasswordIn>,
) -> ApiResult<StatusCode> {
    let hash: Option<String> = sqlx::query_scalar("SELECT password_hash FROM users WHERE id = ?")
        .bind(&user.id)
        .fetch_one(&state.db)
        .await?;
    if !hash.is_some_and(|h| verify_password(&input.current, &h)) {
        return Err(ApiError::invalid("текущий пароль неверен"));
    }
    check_password(&input.new)?;
    sqlx::query("UPDATE users SET password_hash = ? WHERE id = ?")
        .bind(hash_password(&input.new)?)
        .bind(&user.id)
        .execute(&state.db)
        .await?;
    // Остальные сессии гаснут: смена пароля часто означает «меня взломали».
    sqlx::query("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?")
        .bind(&user.id)
        .bind(&user.session_hash)
        .execute(&state.db)
        .await?;
    audit::record(
        &state.db,
        Actor::User(&user),
        "auth.password_changed",
        None,
        json!({}),
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}
