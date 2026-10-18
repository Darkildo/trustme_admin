//! Статус ноды — худшее из последней пробы и последнего отчёта
//! (docs/api.md, «Общие типы»). По смене статуса пишется событие для ленты
//! на обзоре.

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::new_id;

/// Отчёт старше этого считается устаревшим: cron на хосте ноды перестал
/// присылать отчёты.
pub const REPORT_STALE_SECS: u64 = 3 * 3600;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, Hash)]
#[serde(rename_all = "lowercase")]
pub enum NodeStatus {
    Ok,
    Unknown,
    Warn,
    Stale,
    Fail,
}

impl NodeStatus {
    pub const ALL: [Self; 5] = [Self::Ok, Self::Unknown, Self::Warn, Self::Stale, Self::Fail];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ok => "ok",
            Self::Unknown => "unknown",
            Self::Warn => "warn",
            Self::Stale => "stale",
            Self::Fail => "fail",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "ok" => Self::Ok,
            "warn" => Self::Warn,
            "stale" => Self::Stale,
            "fail" => Self::Fail,
            _ => Self::Unknown,
        }
    }
}

/// Статус отчёта `tmnode.report/1`.
pub fn is_check_status(value: &str) -> bool {
    matches!(value, "ok" | "skip" | "warn" | "error" | "fail")
}

/// `probe_ok`: результат последней пробы, `None` — проб не было.
/// `report`: статус и время получения последнего отчёта.
pub fn compute(probe_ok: Option<bool>, report: Option<(&str, u64)>, now: u64) -> NodeStatus {
    let from_probe = match probe_ok {
        None => NodeStatus::Unknown,
        Some(true) => NodeStatus::Ok,
        Some(false) => NodeStatus::Fail,
    };
    let from_report = report.map(|(status, received_at)| {
        if now.saturating_sub(received_at) > REPORT_STALE_SECS {
            return NodeStatus::Stale;
        }
        match status {
            "ok" | "skip" => NodeStatus::Ok,
            "warn" | "error" => NodeStatus::Warn,
            "fail" => NodeStatus::Fail,
            _ => NodeStatus::Unknown,
        }
    });
    from_report.map_or(from_probe, |r| r.max(from_probe))
}

/// Пересчитать статус ноды по последним данным и, если он сменился,
/// записать событие. Возвращает новый статус.
pub async fn refresh(db: &SqlitePool, node_id: &str, now: u64) -> sqlx::Result<NodeStatus> {
    let probe_ok: Option<bool> = sqlx::query_scalar(
        "SELECT ok FROM probes WHERE node_id = ? ORDER BY at DESC, id DESC LIMIT 1",
    )
    .bind(node_id)
    .fetch_optional(db)
    .await?;
    let report: Option<(String, i64)> = sqlx::query_as(
        "SELECT status, received_at FROM reports WHERE node_id = ? ORDER BY received_at DESC, id DESC LIMIT 1",
    )
    .bind(node_id)
    .fetch_optional(db)
    .await?;
    let status = compute(
        probe_ok,
        report.as_ref().map(|(s, at)| (s.as_str(), *at as u64)),
        now,
    );

    let previous: Option<String> = sqlx::query_scalar("SELECT last_status FROM nodes WHERE id = ?")
        .bind(node_id)
        .fetch_optional(db)
        .await?;
    let Some(previous) = previous.map(|p| NodeStatus::parse(&p)) else {
        return Ok(status);
    };
    if previous != status {
        sqlx::query("UPDATE nodes SET last_status = ? WHERE id = ?")
            .bind(status.as_str())
            .bind(node_id)
            .execute(db)
            .await?;
        sqlx::query(
            "INSERT INTO events (id, at, node_id, kind, from_status, to_status, summary)
             VALUES (?, ?, ?, 'status_changed', ?, ?, ?)",
        )
        .bind(new_id())
        .bind(now as i64)
        .bind(node_id)
        .bind(previous.as_str())
        .bind(status.as_str())
        .bind(format!("{} → {}", previous.as_str(), status.as_str()))
        .execute(db)
        .await?;
    }
    Ok(status)
}

/// Пересчитать все ноды: отчёт мог устареть без новых данных.
pub async fn refresh_all(db: &SqlitePool, now: u64) -> sqlx::Result<()> {
    let ids: Vec<String> = sqlx::query_scalar("SELECT id FROM nodes")
        .fetch_all(db)
        .await?;
    for id in ids {
        refresh(db, &id, now).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_is_the_worst_of_probe_and_report() {
        let now = 100_000;
        assert_eq!(compute(None, None, now), NodeStatus::Unknown);
        assert_eq!(compute(Some(true), None, now), NodeStatus::Ok);
        assert_eq!(compute(Some(false), None, now), NodeStatus::Fail);
        assert_eq!(
            compute(Some(true), Some(("skip", now)), now),
            NodeStatus::Ok
        );
        assert_eq!(
            compute(Some(true), Some(("warn", now)), now),
            NodeStatus::Warn
        );
        assert_eq!(
            compute(Some(true), Some(("error", now)), now),
            NodeStatus::Warn
        );
        assert_eq!(
            compute(Some(true), Some(("fail", now)), now),
            NodeStatus::Fail
        );
        assert_eq!(compute(None, Some(("ok", now)), now), NodeStatus::Unknown);
        assert_eq!(
            compute(Some(false), Some(("warn", now)), now),
            NodeStatus::Fail
        );
        assert_eq!(
            compute(Some(true), Some(("ok", now - REPORT_STALE_SECS - 1)), now),
            NodeStatus::Stale
        );
        assert_eq!(
            compute(Some(true), Some(("weird", now)), now),
            NodeStatus::Unknown
        );
    }

    #[test]
    fn statuses_round_trip() {
        for s in NodeStatus::ALL {
            assert_eq!(NodeStatus::parse(s.as_str()), s);
        }
        assert_eq!(NodeStatus::parse("other"), NodeStatus::Unknown);
        assert!(is_check_status("error") && !is_check_status("bad"));
    }
}
