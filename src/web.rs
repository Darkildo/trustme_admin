//! Встроенная панель (`web/dist`) и заголовки безопасности.

use axum::body::Body;
use axum::extract::Request;
use axum::http::{HeaderValue, StatusCode, Uri, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use rust_embed::Embed;

/// Сборка панели. Без неё сервер собирается и отдаёт API, а вместо панели —
/// подсказку, как её собрать.
#[derive(Embed)]
#[folder = "web/dist"]
#[allow_missing = true]
struct Panel;

/// Внешних источников нет: шрифты, иконки и графики — свои. Инлайн-стили
/// нужны графикам и анимациям.
const CSP: &str = "default-src 'self'; img-src 'self'; style-src 'self' 'unsafe-inline'; \
                   font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; \
                   form-action 'self'; frame-ancestors 'none'";

pub async fn serve(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    if path.starts_with("api/") {
        return crate::error::ApiError::not_found().into_response();
    }
    if !path.is_empty()
        && let Some(file) = Panel::get(path)
    {
        let mime = file.metadata.mimetype().to_owned();
        // Файлы из assets/ носят хэш в имени и не меняются.
        let cache = if path.starts_with("assets/") {
            "public, max-age=31536000, immutable"
        } else {
            "no-cache"
        };
        return (
            [
                (header::CONTENT_TYPE, mime),
                (header::CACHE_CONTROL, cache.to_owned()),
            ],
            Body::from(file.data.into_owned()),
        )
            .into_response();
    }
    // SPA: любой другой путь — index.html, маршрут разберёт сама панель.
    match Panel::get("index.html") {
        Some(index) => (
            [
                (header::CONTENT_TYPE, "text/html; charset=utf-8".to_owned()),
                (header::CACHE_CONTROL, "no-cache".to_owned()),
            ],
            Body::from(index.data.into_owned()),
        )
            .into_response(),
        None => (
            StatusCode::NOT_FOUND,
            "Панель не собрана: выполните `pnpm --dir web install && pnpm --dir web build` и пересоберите сервер.",
        )
            .into_response(),
    }
}

pub async fn security_headers(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    for (name, value) in [
        (header::CONTENT_SECURITY_POLICY, CSP),
        (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        (header::REFERRER_POLICY, "no-referrer"),
        (header::X_FRAME_OPTIONS, "DENY"),
    ] {
        headers.insert(name, HeaderValue::from_static(value));
    }
    response
}
