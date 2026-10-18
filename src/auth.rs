//! Вход: сессии в cookie, роли, защита от перебора, TOTP, CSRF.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Mutex;

use axum::extract::{ConnectInfo, FromRequestParts, Request};
use axum::http::request::Parts;
use axum::http::{HeaderMap, Method, header};
use axum::middleware::Next;
use axum::response::Response;
use serde::{Deserialize, Serialize};
use totp_rs::{Algorithm, Builder, Secret, Totp};

use crate::crypto::{new_token, token_hash};
use crate::error::{ApiError, ApiResult};
use crate::{AppState, now};

pub const SESSION_COOKIE: &str = "tm_admin_session";
/// Сессия гаснет после 12 ч бездействия…
pub const SESSION_IDLE_SECS: u64 = 12 * 3600;
/// …и в любом случае через 7 суток.
pub const SESSION_MAX_SECS: u64 = 7 * 86_400;
/// Заголовок, без которого изменяющий запрос с cookie не принимается.
pub const CSRF_HEADER: &str = "x-trustme-admin";
const TOTP_ISSUER: &str = "TrustMe Admin";

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Viewer,
    Admin,
    Owner,
}

impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Viewer => "viewer",
            Self::Admin => "admin",
            Self::Owner => "owner",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "viewer" => Some(Self::Viewer),
            "admin" => Some(Self::Admin),
            "owner" => Some(Self::Owner),
            _ => None,
        }
    }
}

/// Вошедший пользователь.
#[derive(Debug, Clone)]
pub struct CurrentUser {
    pub id: String,
    pub username: String,
    pub role: Role,
    pub session_hash: String,
    pub ip: Option<String>,
}

impl CurrentUser {
    pub fn require(&self, role: Role) -> ApiResult<()> {
        if self.role >= role {
            Ok(())
        } else {
            Err(ApiError::forbidden("недостаточно прав"))
        }
    }
}

impl FromRequestParts<AppState> for CurrentUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> ApiResult<Self> {
        let token = session_cookie(&parts.headers).ok_or_else(ApiError::unauthorized)?;
        let hash = token_hash(&token);
        let now = now() as i64;
        let row: Option<(String, String, String, i64, i64)> = sqlx::query_as(
            "SELECT u.id, u.username, u.role, s.created_at, s.last_seen_at
             FROM sessions s JOIN users u ON u.id = s.user_id
             WHERE s.token_hash = ? AND u.disabled = 0",
        )
        .bind(&hash)
        .fetch_optional(&state.db)
        .await?;
        let Some((id, username, role, created_at, last_seen_at)) = row else {
            return Err(ApiError::unauthorized());
        };
        if now - last_seen_at > SESSION_IDLE_SECS as i64
            || now - created_at > SESSION_MAX_SECS as i64
        {
            sqlx::query("DELETE FROM sessions WHERE token_hash = ?")
                .bind(&hash)
                .execute(&state.db)
                .await?;
            return Err(ApiError::unauthorized());
        }
        // Скользящий срок; писать в базу на каждый запрос незачем.
        if now - last_seen_at > 60 {
            sqlx::query("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?")
                .bind(now)
                .bind(&hash)
                .execute(&state.db)
                .await?;
        }
        Ok(Self {
            id,
            username,
            role: Role::parse(&role).unwrap_or(Role::Viewer),
            session_hash: hash,
            ip: client_ip(parts, state.trust_proxy),
        })
    }
}

/// Адрес клиента для журнала и лимитов.
#[derive(Debug, Clone)]
pub struct ClientIp(pub Option<String>);

impl FromRequestParts<AppState> for ClientIp {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        Ok(Self(client_ip(parts, state.trust_proxy)))
    }
}

fn client_ip(parts: &Parts, trust_proxy: bool) -> Option<String> {
    if trust_proxy
        && let Some(forwarded) = parts
            .headers
            .get("x-forwarded-for")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.split(',').next())
    {
        return Some(forwarded.trim().to_owned());
    }
    parts
        .extensions
        .get::<ConnectInfo<SocketAddr>>()
        .map(|ConnectInfo(addr)| addr.ip().to_string())
}

fn session_cookie(headers: &HeaderMap) -> Option<String> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .find(|(name, _)| *name == SESSION_COOKIE)
        .map(|(_, value)| value.to_owned())
}

/// Завести сессию и вернуть значение `Set-Cookie`.
pub async fn start_session(
    state: &AppState,
    user_id: &str,
    headers: &HeaderMap,
    ip: Option<&str>,
) -> ApiResult<String> {
    let token = new_token("tms_");
    let now = now() as i64;
    let user_agent = headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.chars().take(256).collect::<String>());
    sqlx::query(
        "INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, user_agent, ip)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(token_hash(&token))
    .bind(user_id)
    .bind(now)
    .bind(now)
    .bind(user_agent)
    .bind(ip)
    .execute(&state.db)
    .await?;
    sqlx::query("UPDATE users SET last_login_at = ? WHERE id = ?")
        .bind(now)
        .bind(user_id)
        .execute(&state.db)
        .await?;
    Ok(session_set_cookie(&token, state.secure_cookies))
}

pub fn session_set_cookie(token: &str, secure: bool) -> String {
    format!(
        "{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={SESSION_MAX_SECS}{}",
        if secure { "; Secure" } else { "" }
    )
}

pub fn session_clear_cookie(secure: bool) -> String {
    format!(
        "{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0{}",
        if secure { "; Secure" } else { "" }
    )
}

/// CSRF: изменяющий запрос обязан нести `X-TrustMe-Admin: 1`. Браузер не
/// пошлёт нестандартный заголовок с чужого сайта без CORS, а CORS админка не
/// разрешает. Приём отчётов идёт по Bearer-токену и cookie не использует.
pub async fn csrf_guard(request: Request, next: Next) -> Result<Response, ApiError> {
    let mutating = !matches!(
        *request.method(),
        Method::GET | Method::HEAD | Method::OPTIONS
    );
    let ingest = request.uri().path().ends_with("/ingest/report");
    if mutating
        && !ingest
        && request
            .headers()
            .get(CSRF_HEADER)
            .and_then(|v| v.to_str().ok())
            != Some("1")
    {
        return Err(ApiError::forbidden("нет заголовка X-TrustMe-Admin"));
    }
    Ok(next.run(request).await)
}

/// Защита от перебора: после 5 неудач подряд по IP или по логину — пауза
/// 30 с, вдвое длиннее с каждой следующей неудачей, до 15 минут.
#[derive(Default)]
pub struct LoginLimiter {
    failures: Mutex<HashMap<String, (u32, u64)>>,
}

const FREE_ATTEMPTS: u32 = 5;
const FIRST_LOCK_SECS: u64 = 30;
const MAX_LOCK_SECS: u64 = 15 * 60;

impl LoginLimiter {
    fn keys(username: &str, ip: Option<&str>) -> Vec<String> {
        let mut keys = vec![format!("u:{}", username.to_lowercase())];
        if let Some(ip) = ip {
            keys.push(format!("ip:{ip}"));
        }
        keys
    }

    /// `Err(секунд)` — вход сейчас заблокирован.
    pub fn check(&self, username: &str, ip: Option<&str>, now: u64) -> Result<(), u64> {
        let failures = self.failures.lock().expect("limiter lock");
        let wait = Self::keys(username, ip)
            .iter()
            .filter_map(|k| failures.get(k))
            .filter_map(|(count, last)| {
                let lock = lock_secs(*count);
                (lock > 0 && now < last + lock).then(|| last + lock - now)
            })
            .max();
        match wait {
            Some(secs) => Err(secs),
            None => Ok(()),
        }
    }

    pub fn failed(&self, username: &str, ip: Option<&str>, now: u64) {
        let mut failures = self.failures.lock().expect("limiter lock");
        // Старые записи (дольше максимальной паузы без новых неудач) уходят.
        failures.retain(|_, (_, last)| now < *last + MAX_LOCK_SECS * 2);
        for key in Self::keys(username, ip) {
            let entry = failures.entry(key).or_insert((0, now));
            entry.0 += 1;
            entry.1 = now;
        }
    }

    pub fn succeeded(&self, username: &str, ip: Option<&str>) {
        let mut failures = self.failures.lock().expect("limiter lock");
        for key in Self::keys(username, ip) {
            failures.remove(&key);
        }
    }
}

fn lock_secs(failures: u32) -> u64 {
    if failures < FREE_ATTEMPTS {
        return 0;
    }
    let exp = (failures - FREE_ATTEMPTS).min(10);
    (FIRST_LOCK_SECS << exp).min(MAX_LOCK_SECS)
}

pub fn new_totp_secret() -> Secret {
    Secret::generate()
}

pub fn totp(secret_base32: &str, username: &str) -> ApiResult<Totp> {
    let secret = Secret::try_from_base32(secret_base32).map_err(|_| ApiError::internal())?;
    Builder::new()
        .with_algorithm(Algorithm::SHA1)
        .with_digits(6)
        .with_skew(1)
        .with_step_duration(30)
        .with_secret(secret)
        .with_issuer(Some(TOTP_ISSUER))
        .with_account_name(username)
        .build()
        .map_err(|_| ApiError::internal())
}

/// Проверить код. Возвращает шаг, на котором код верен: повтор кода с тем же
/// или более ранним шагом не принимается.
pub fn check_totp(totp: &Totp, code: &str, last_step: Option<i64>, now: u64) -> Option<i64> {
    let code: String = code.chars().filter(|c| !c.is_whitespace()).collect();
    let step = totp.check(&code, now)? as i64;
    match last_step {
        Some(last) if step <= last => None,
        _ => Some(step),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roles_are_ordered() {
        assert!(Role::Owner > Role::Admin && Role::Admin > Role::Viewer);
        for role in [Role::Viewer, Role::Admin, Role::Owner] {
            assert_eq!(Role::parse(role.as_str()), Some(role));
        }
        assert_eq!(Role::parse("root"), None);
    }

    #[test]
    fn limiter_backs_off_and_resets() {
        let limiter = LoginLimiter::default();
        for _ in 0..4 {
            limiter.failed("alice", Some("1.2.3.4"), 100);
        }
        assert!(limiter.check("alice", Some("1.2.3.4"), 100).is_ok());
        limiter.failed("alice", Some("1.2.3.4"), 100);
        assert_eq!(limiter.check("alice", None, 100), Err(30));
        // Тот же IP с другим логином тоже ждёт.
        assert_eq!(limiter.check("bob", Some("1.2.3.4"), 110), Err(20));
        assert!(limiter.check("alice", None, 130).is_ok());
        limiter.failed("alice", None, 130);
        assert_eq!(limiter.check("alice", None, 130), Err(60));
        for _ in 0..20 {
            limiter.failed("alice", None, 200);
        }
        assert_eq!(limiter.check("ALICE", None, 200), Err(MAX_LOCK_SECS));
        limiter.succeeded("alice", None);
        assert!(limiter.check("alice", None, 200).is_ok());
    }

    #[test]
    fn totp_codes_are_single_use() {
        let secret = new_totp_secret().to_base32();
        let totp = totp(&secret, "alice").unwrap();
        let now = 1_800_000_000;
        let code = totp.generate(now).to_string();
        let step = check_totp(&totp, &code, None, now).expect("fresh code");
        assert_eq!(check_totp(&totp, &code, Some(step), now), None);
        assert_eq!(check_totp(&totp, "000000x", None, now), None);
        let later = totp.generate(now + 30).to_string();
        assert!(check_totp(&totp, &later, Some(step), now + 30).is_some());
        assert!(
            totp.to_url()
                .unwrap()
                .starts_with("otpauth://totp/TrustMe%20Admin:alice")
        );
    }

    #[test]
    fn cookies_carry_the_right_flags() {
        let set = session_set_cookie("tms_x", true);
        assert!(
            set.contains("HttpOnly") && set.contains("SameSite=Strict") && set.ends_with("Secure")
        );
        assert!(!session_set_cookie("tms_x", false).contains("Secure"));
        assert!(session_clear_cookie(false).contains("Max-Age=0"));

        let mut headers = HeaderMap::new();
        headers.insert(
            header::COOKIE,
            "a=1; tm_admin_session=tms_abc; b=2".parse().unwrap(),
        );
        assert_eq!(session_cookie(&headers).as_deref(), Some("tms_abc"));
    }
}
