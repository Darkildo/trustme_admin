//! Сводка парка для главного экрана.

use std::collections::BTreeMap;

use axum::Json;
use axum::extract::State;
use serde_json::{Value, json};

use super::nodes::{all_nodes, list_item, status_of, uptime_24h};
use crate::auth::CurrentUser;
use crate::error::ApiResult;
use crate::status::NodeStatus;
use crate::{AppState, now};

const HOURS: i64 = 24;

#[derive(sqlx::FromRow)]
struct EventRow {
    at: i64,
    node_id: String,
    node_name: String,
    kind: String,
    from_status: Option<String>,
    to_status: Option<String>,
    summary: String,
}

pub async fn overview(State(state): State<AppState>, _user: CurrentUser) -> ApiResult<Json<Value>> {
    let now = now();
    let since = now as i64 - HOURS * 3600;
    let db = &state.db;

    // Доля успешных проб по часам: 24 корзины, старшая — текущий час.
    let buckets: Vec<(String, i64, f64)> = sqlx::query_as(
        "SELECT node_id, (at - ?) / 3600 AS bucket, AVG(ok)
         FROM probes WHERE at >= ? GROUP BY node_id, bucket",
    )
    .bind(since)
    .bind(since)
    .fetch_all(db)
    .await?;
    let mut spark: BTreeMap<String, Vec<f64>> = BTreeMap::new();
    for (node, bucket, ratio) in buckets {
        let line = spark
            .entry(node)
            .or_insert_with(|| vec![-1.0; HOURS as usize]);
        if let Some(slot) = line.get_mut(bucket.clamp(0, HOURS - 1) as usize) {
            *slot = ratio;
        }
    }

    let uptime = uptime_24h(db, now).await?;
    let mut by_status: BTreeMap<&str, u64> =
        NodeStatus::ALL.iter().map(|s| (s.as_str(), 0)).collect();
    let mut tiles = Vec::new();
    let mut total = 0;
    for row in all_nodes(db).await? {
        let item = list_item(db, &row, uptime.get(&row.id).copied(), now).await?;
        let status = status_of(&item);
        *by_status.entry(status.as_str()).or_default() += 1;
        total += 1;
        tiles.push(json!({
            "id": row.id,
            "name": row.name,
            "status": status,
            "handshake_ms": item["last_probe"]["handshake_ms"],
            "uptime_24h": item["uptime_24h"],
            "spark": spark.remove(&row.id).unwrap_or_else(|| vec![-1.0; HOURS as usize]),
        }));
    }

    let events: Vec<EventRow> = sqlx::query_as(
        "SELECT e.at, e.node_id, n.name AS node_name, e.kind, e.from_status, e.to_status, e.summary
             FROM events e JOIN nodes n ON n.id = e.node_id
             ORDER BY e.at DESC, e.id DESC LIMIT 50",
    )
    .fetch_all(db)
    .await?;
    let events: Vec<Value> = events
        .into_iter()
        .map(|e| {
            let mut event = json!({
                "at": e.at, "node_id": e.node_id, "node_name": e.node_name,
                "kind": e.kind, "summary": e.summary,
            });
            if let Some(from) = e.from_status {
                event["from"] = json!(from);
            }
            if let Some(to) = e.to_status {
                event["to"] = json!(to);
            }
            event
        })
        .collect();

    // Медиана рукопожатия по парку за каждый час.
    let samples: Vec<(i64, i64)> = sqlx::query_as(
        "SELECT (at - ?) / 3600, handshake_ms FROM probes
         WHERE at >= ? AND ok = 1 AND handshake_ms IS NOT NULL",
    )
    .bind(since)
    .bind(since)
    .fetch_all(db)
    .await?;
    let mut per_hour: Vec<Vec<i64>> = vec![Vec::new(); HOURS as usize];
    for (bucket, ms) in samples {
        per_hour[bucket.clamp(0, HOURS - 1) as usize].push(ms);
    }
    let latency: Vec<Value> = per_hour
        .into_iter()
        .enumerate()
        .map(|(i, mut values)| {
            values.sort_unstable();
            let p50 = (!values.is_empty()).then(|| values[values.len() / 2]);
            json!({ "at": since + i as i64 * 3600, "handshake_ms_p50": p50 })
        })
        .collect();

    Ok(Json(json!({
        "nodes": { "total": total, "by_status": by_status },
        "tiles": tiles,
        "events": events,
        "latency": latency,
    })))
}
