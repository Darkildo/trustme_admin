//! TrustMe Admin — панель управления нодами TrustMe (docs/PROMPT.md).
//!
//! Один процесс: REST API `/api/v1`, встроенная панель, планировщик проб и
//! чистка истории. Данные — в SQLite рядом с бинарём.

pub mod api;
pub mod audit;
pub mod auth;
pub mod config;
pub mod crypto;
pub mod db;
pub mod error;
pub mod probe;
pub mod status;
pub mod web;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use sqlx::SqlitePool;

use crate::auth::LoginLimiter;
use crate::crypto::SecretBox;
use crate::probe::Prober;

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub fn new_id() -> String {
    ulid::Ulid::generate().to_string()
}

/// Общее состояние обработчиков.
#[derive(Clone)]
pub struct AppState(Arc<Inner>);

pub struct Inner {
    pub db: SqlitePool,
    pub secrets: SecretBox,
    pub prober: Arc<dyn Prober>,
    pub login_limiter: LoginLimiter,
    /// Время последнего принятого отчёта по ноде — не чаще раза в 10 с.
    pub ingest_seen: Mutex<HashMap<String, u64>>,
    /// Ставить ли cookie с `Secure` (панель открыта по HTTPS).
    pub secure_cookies: bool,
    /// Брать адрес клиента из `X-Forwarded-For` (админка за прокси).
    pub trust_proxy: bool,
}

impl AppState {
    pub fn new(db: SqlitePool, secrets: SecretBox, prober: Arc<dyn Prober>) -> Self {
        Self(Arc::new(Inner {
            db,
            secrets,
            prober,
            login_limiter: LoginLimiter::default(),
            ingest_seen: Mutex::new(HashMap::new()),
            secure_cookies: false,
            trust_proxy: false,
        }))
    }

    pub fn with_options(mut self, secure_cookies: bool, trust_proxy: bool) -> Self {
        let inner = Arc::get_mut(&mut self.0).expect("options are set before sharing the state");
        inner.secure_cookies = secure_cookies;
        inner.trust_proxy = trust_proxy;
        self
    }
}

impl std::ops::Deref for AppState {
    type Target = Inner;

    fn deref(&self) -> &Inner {
        &self.0
    }
}

/// Приложение целиком: API, панель, заголовки безопасности.
pub fn app(state: AppState) -> axum::Router {
    axum::Router::new()
        .nest("/api/v1", api::router(state.clone()))
        .fallback(web::serve)
        .layer(axum::middleware::from_fn(web::security_headers))
        .with_state(state)
}
