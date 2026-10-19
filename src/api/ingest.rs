//! Приём отчётов `tmnode doctor --json` по токену ноды.
//!
//! Отчёт разбирается по JSON-контракту `tmnode.report/1` своими типами:
//! незнакомые проверки и поля не мешают, чужой формат — отказ.

use axum::Json;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode, header};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use crate::crypto::token_hash;
use crate::error::{ApiError, ApiResult};
use crate::status::{self, is_check_status};
use crate::{AppState, db, new_id, now};

pub const REPORT_FORMAT: &str = "tmnode.report/1";
/// Не чаще одного отчёта на ноду за это время.
const MIN_INTERVAL_SECS: u64 = 10;

#[derive(Debug, Deserialize, Serialize)]
pub struct ReportIn {
    pub format: String,
    pub tmnode_version: String,
    pub generated_at: u64,
    #[serde(default)]
    pub target: Map<String, Value>,
    pub status: String,
    pub counts: Counts,
    pub checks: Vec<CheckIn>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Counts {
    pub ok: u64,
    pub skip: u64,
    pub warn: u64,
    pub error: u64,
    pub fail: u64,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct CheckIn {
    pub id: String,
    pub status: String,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
    #[serde(default, skip_serializing_if = "Map::is_empty")]
    pub data: Map<String, Value>,
}

/// Разобрать и проверить отчёт.
pub fn parse_report(body: &[u8]) -> ApiResult<ReportIn> {
    let probe: Value = serde_json::from_slice(body)
        .map_err(|e| ApiError::unprocessable(format!("тело — не JSON: {e}")))?;
    match probe.get("format").and_then(Value::as_str) {
        Some(REPORT_FORMAT) => {}
        Some(other) => {
            return Err(ApiError::unprocessable(format!(
                "формат `{other}` не поддерживается, ожидается {REPORT_FORMAT}"
            )));
        }
        None => return Err(ApiError::unprocessable("нет поля format")),
    }
    let report: ReportIn = serde_json::from_value(probe)
        .map_err(|e| ApiError::unprocessable(format!("отчёт не по контракту: {e}")))?;
    if !is_check_status(&report.status) {
        return Err(ApiError::unprocessable(format!(
            "статус `{}` неизвестен",
            report.status
        )));
    }
    if let Some(bad) = report.checks.iter().find(|c| !is_check_status(&c.status)) {
        return Err(ApiError::unprocessable(format!(
            "проверка {}: статус `{}` неизвестен",
            bad.id, bad.status
        )));
    }
    if report.checks.len() > 256 {
        return Err(ApiError::unprocessable("слишком много проверок"));
    }
    Ok(report)
}

/// Самая тяжёлая проблема отчёта — одной строкой для ленты событий.
fn worst_check(report: &ReportIn) -> Option<String> {
    let rank = |s: &str| match s {
        "fail" => 3,
        "error" => 2,
        "warn" => 1,
        _ => 0,
    };
    report
        .checks
        .iter()
        .filter(|c| rank(&c.status) > 0)
        .max_by_key(|c| rank(&c.status))
        .map(|c| format!("{}: {}", c.id, c.summary))
}

/// Сохранить разобранный отчёт ноды: история, событие о новой проблеме,
/// пересчёт статуса. Общая для приёма по токену и heartbeat агента.
pub async fn store_report(
    db: &sqlx::SqlitePool,
    node_id: &str,
    report: &ReportIn,
    now: u64,
) -> ApiResult<String> {
    let previous: Option<String> = sqlx::query_scalar(
        "SELECT status FROM reports WHERE node_id = ? ORDER BY received_at DESC, id DESC LIMIT 1",
    )
    .bind(node_id)
    .fetch_optional(db)
    .await?;

    let id = new_id();
    sqlx::query(
        "INSERT INTO reports (id, node_id, received_at, generated_at, status, counts, tmnode_version, body)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(node_id)
    .bind(now as i64)
    .bind(report.generated_at as i64)
    .bind(&report.status)
    .bind(serde_json::to_string(&report.counts).expect("counts serialize"))
    .bind(&report.tmnode_version)
    .bind(serde_json::to_string(report).expect("report serializes"))
    .execute(db)
    .await?;
    sqlx::query(
        "DELETE FROM reports WHERE node_id = ? AND id NOT IN (
             SELECT id FROM reports WHERE node_id = ? ORDER BY received_at DESC, id DESC LIMIT ?
         )",
    )
    .bind(node_id)
    .bind(node_id)
    .bind(db::REPORTS_PER_NODE)
    .execute(db)
    .await?;

    // Новая проблема в отчёте — событие для ленты, даже если статус ноды не
    // сменился (например, к сломанной проверке добавилась ещё одна).
    if matches!(report.status.as_str(), "warn" | "error" | "fail")
        && previous.as_deref() != Some(report.status.as_str())
        && let Some(summary) = worst_check(report)
    {
        sqlx::query(
            "INSERT INTO events (id, at, node_id, kind, summary) VALUES (?, ?, ?, 'report_problem', ?)",
        )
        .bind(new_id())
        .bind(now as i64)
        .bind(node_id)
        .bind(summary)
        .execute(db)
        .await?;
    }
    status::refresh(db, node_id, now).await?;
    Ok(id)
}

pub async fn report(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or_else(ApiError::unauthorized)?;
    let node: Option<(String, String)> =
        sqlx::query_as("SELECT id, name FROM nodes WHERE ingest_token_hash = ?")
            .bind(token_hash(token.trim()))
            .fetch_optional(&state.db)
            .await?;
    let (node_id, _name) = node.ok_or_else(ApiError::unauthorized)?;

    let now = now();
    {
        let mut seen = state.ingest_seen.lock().expect("ingest lock");
        if let Some(last) = seen.get(&node_id)
            && now < last + MIN_INTERVAL_SECS
        {
            return Err(ApiError::rate_limited(last + MIN_INTERVAL_SECS - now));
        }
        seen.insert(node_id.clone(), now);
    }

    let report = parse_report(&body)?;
    let id = store_report(&state.db, &node_id, &report, now).await?;
    Ok((StatusCode::ACCEPTED, Json(json!({ "report_id": id }))))
}

#[cfg(test)]
mod tests {
    use super::*;

    const REPORT: &str = r#"{
        "format": "tmnode.report/1", "tmnode_version": "0.1.0", "generated_at": 5,
        "target": {"addr": "127.0.0.1:18081"}, "status": "warn",
        "counts": {"ok": 1, "skip": 0, "warn": 1, "error": 0, "fail": 0},
        "checks": [
            {"id": "host.disk", "status": "warn", "summary": "мало места", "hint": "расширьте", "data": {"available_bytes": 1}},
            {"id": "future.check", "status": "ok", "summary": "новое", "extra": true}
        ],
        "future_field": 1
    }"#;

    #[test]
    fn report_is_parsed_by_contract() {
        let report = parse_report(REPORT.as_bytes()).unwrap();
        assert_eq!(report.checks.len(), 2);
        assert_eq!(
            worst_check(&report).as_deref(),
            Some("host.disk: мало места")
        );
        let stored = serde_json::to_value(&report).unwrap();
        assert!(stored["checks"][1].get("data").is_none());
        assert_eq!(stored["checks"][0]["hint"], "расширьте");
    }

    #[test]
    fn foreign_reports_are_rejected() {
        let other = REPORT.replace("tmnode.report/1", "tmnode.report/2");
        assert!(
            parse_report(other.as_bytes())
                .unwrap_err()
                .message
                .contains("tmnode.report/2")
        );
        assert!(parse_report(b"[]").unwrap_err().message.contains("format"));
        assert!(parse_report(b"nope").is_err());
        let bad_status = REPORT.replace(r#""status": "warn""#, r#""status": "great""#);
        assert!(parse_report(bad_status.as_bytes()).is_err());
        let bad_check = REPORT.replace(r#""status": "ok""#, r#""status": "meh""#);
        assert!(
            parse_report(bad_check.as_bytes())
                .unwrap_err()
                .message
                .contains("future.check")
        );
        let missing = REPORT.replace(r#""counts""#, r#""counters""#);
        assert!(parse_report(missing.as_bytes()).is_err());
    }
}
