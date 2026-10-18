//! REST API `/api/v1` (docs/api.md).

mod audit_log;
mod auth;
mod ingest;
mod nodes;
mod overview;
mod setup;
mod users;

use axum::Json;
use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::middleware;
use axum::routing::{get, post};
use serde::Serialize;
use serde_json::{Value, json};

use crate::AppState;
use crate::error::ApiError;

pub use setup::ensure_setup_token;

/// Предел тела обычного запроса.
const BODY_LIMIT: usize = 64 * 1024;
/// Предел отчёта `tmnode doctor --json`.
pub const REPORT_LIMIT: usize = 256 * 1024;

pub fn router(_state: AppState) -> Router<AppState> {
    Router::new()
        .route("/health", get(health))
        .route("/setup", get(setup::status).post(setup::complete))
        .route("/auth/login", post(auth::login))
        .route("/auth/logout", post(auth::logout))
        .route("/auth/me", get(auth::me))
        .route("/auth/totp/setup", post(auth::totp_setup))
        .route("/auth/totp/enable", post(auth::totp_enable))
        .route("/auth/totp/disable", post(auth::totp_disable))
        .route("/auth/password", post(auth::change_password))
        .route("/overview", get(overview::overview))
        .route("/nodes", get(nodes::list).post(nodes::create))
        .route(
            "/nodes/{id}",
            get(nodes::detail)
                .patch(nodes::update)
                .delete(nodes::remove),
        )
        .route("/nodes/{id}/probe", post(nodes::probe_now))
        .route("/nodes/{id}/probes", get(nodes::probes))
        .route("/nodes/{id}/reports", get(nodes::reports))
        .route("/nodes/{id}/reports/{rid}", get(nodes::report))
        .route("/nodes/{id}/ingest-token", post(nodes::rotate_token))
        .route(
            "/ingest/report",
            post(ingest::report).layer(DefaultBodyLimit::max(REPORT_LIMIT)),
        )
        .route("/users", get(users::list).post(users::invite))
        .route(
            "/users/{id}",
            axum::routing::patch(users::update).delete(users::remove),
        )
        .route(
            "/invite",
            get(users::invite_info).post(users::accept_invite),
        )
        .route("/audit", get(audit_log::list))
        .fallback(|| async { ApiError::not_found() })
        .layer(DefaultBodyLimit::max(BODY_LIMIT))
        .layer(middleware::from_fn(crate::auth::csrf_guard))
}

async fn health() -> Json<Value> {
    Json(json!({ "status": "ok", "version": env!("CARGO_PKG_VERSION") }))
}

/// Пользователь в ответах API.
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct UserOut {
    pub id: String,
    pub username: String,
    pub role: String,
    pub totp_enabled: bool,
    pub disabled: bool,
    pub created_at: i64,
    pub last_login_at: Option<i64>,
}

macro_rules! user_columns {
    () => {
        "id, username, role, totp_secret IS NOT NULL AS totp_enabled, \
                                disabled, created_at, last_login_at"
    };
}
pub(crate) use user_columns;

pub async fn load_user(db: &sqlx::SqlitePool, id: &str) -> Result<UserOut, ApiError> {
    sqlx::query_as::<_, UserOut>(concat!(
        "SELECT ",
        user_columns!(),
        " FROM users WHERE id = ?"
    ))
    .bind(id)
    .fetch_optional(db)
    .await?
    .ok_or_else(ApiError::not_found)
}

/// Имя пользователя: латиница, цифры, `.`, `_`, `-`, от 2 до 32 символов.
pub fn check_username(username: &str) -> Result<(), ApiError> {
    let ok = (2..=32).contains(&username.len())
        && username
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    if ok {
        Ok(())
    } else {
        Err(ApiError::invalid(
            "имя: от 2 до 32 символов, латиница, цифры, точка, `_` и `-`",
        ))
    }
}

pub fn check_password(password: &str) -> Result<(), ApiError> {
    let len = password.chars().count();
    if (10..=256).contains(&len) {
        Ok(())
    } else {
        Err(ApiError::invalid("пароль: от 10 до 256 символов"))
    }
}
