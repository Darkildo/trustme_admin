//! Резерв диска под файлы ноды (`blob_disk_reserve_bytes`).
//!
//! Резерв по умолчанию — 5 ГиБ. На маленьком диске он бывает больше
//! свободного места: нода отвечает на загрузку файлов `QUOTA`, а
//! `tmnode doctor` предупреждает `host.blob_reserve`. Панель подбирает резерв
//! по отчёту и задаёт его переопределением ноды: агент доставит настройку,
//! нода применит её без перезапуска.
//!
//! Подбор — по кнопке у предупреждения или сам, по первому отчёту новой
//! ноды, если при подготовке оставили `auto_blob_reserve`.

use axum::Json;
use axum::extract::{Path, State};
use serde_json::{Value, json};

use super::agents::Provision;
use super::ingest::{CheckIn, ReportIn};
use crate::audit::{self, Actor};
use crate::auth::{ClientIp, CurrentUser, Role};
use crate::desired;
use crate::error::{ApiError, ApiResult};
use crate::{AppState, now};

/// Настройка каталога ноды.
pub const KEY: &str = "blob_disk_reserve_bytes";

const MIB: u64 = 1 << 20;
const MIN_RESERVE: u64 = 512 * MIB;
const MAX_RESERVE: u64 = 5 << 30;
const STEP: u64 = 256 * MIB;

/// Резерв для диска: 10 % объёма, от 512 МиБ до 5 ГиБ, кратно 256 МиБ, и не
/// больше половины свободного места — иначе под файлы почти ничего не
/// останется. Меньше 512 МиБ не опускаемся: диск почти полон, нода может
/// забить его целиком — тут поможет только место, а не резерв (`None`).
pub fn suggest(total: u64, available: u64) -> Option<u64> {
    let by_disk = (total / 10).clamp(MIN_RESERVE, MAX_RESERVE) / STEP * STEP;
    let reserve = by_disk.min(available / 2 / MIB * MIB);
    (reserve >= MIN_RESERVE).then_some(reserve)
}

/// Место под файлы по отчёту `tmnode doctor`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Reading {
    pub available: u64,
    pub reserve: u64,
    /// Объём диска (`host.disk`); без него резерв не подобрать.
    pub total: Option<u64>,
}

impl Reading {
    pub fn from_checks(checks: &[CheckIn]) -> Option<Self> {
        let num = |id: &str, field: &str| {
            checks
                .iter()
                .find(|c| c.id == id)
                .and_then(|c| c.data.get(field))
                .and_then(Value::as_u64)
        };
        Some(Self {
            available: num("host.blob_reserve", "available_bytes")?,
            reserve: num("host.blob_reserve", "reserve_bytes")?,
            total: num("host.disk", "total_bytes"),
        })
    }

    /// Новый резерв — только если места меньше нынешнего резерва и
    /// подобранный действительно меньше.
    pub fn suggestion(&self) -> Option<u64> {
        if self.available > self.reserve {
            return None;
        }
        suggest(self.total?, self.available).filter(|s| *s < self.reserve)
    }
}

async fn latest_reading(state: &AppState, node_id: &str) -> ApiResult<Option<Reading>> {
    let body: Option<String> = sqlx::query_scalar(
        "SELECT body FROM reports WHERE node_id = ? ORDER BY received_at DESC, id DESC LIMIT 1",
    )
    .bind(node_id)
    .fetch_optional(&state.db)
    .await?;
    Ok(body
        .and_then(|b| serde_json::from_str::<ReportIn>(&b).ok())
        .and_then(|r| Reading::from_checks(&r.checks)))
}

async fn node_name(state: &AppState, node_id: &str) -> ApiResult<String> {
    sqlx::query_scalar("SELECT name FROM nodes WHERE id = ?")
        .bind(node_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(ApiError::not_found)
}

async fn managed(state: &AppState, node_id: &str) -> ApiResult<bool> {
    let agent: Option<String> = sqlx::query_scalar("SELECT id FROM agents WHERE node_id = ?")
        .bind(node_id)
        .fetch_optional(&state.db)
        .await?;
    Ok(agent.is_some())
}

/// Записать резерв в переопределения ноды.
async fn set_override(state: &AppState, node_id: &str, reserve: u64) -> ApiResult<()> {
    let mut overrides = desired::effective(&state.db, node_id).await?.overrides;
    overrides.insert(KEY.to_owned(), reserve);
    desired::check_settings(&overrides).map_err(ApiError::invalid)?;
    sqlx::query("UPDATE nodes SET overrides = ?, updated_at = ? WHERE id = ?")
        .bind(serde_json::to_string(&overrides).expect("overrides serialize"))
        .bind(now() as i64)
        .bind(node_id)
        .execute(&state.db)
        .await?;
    Ok(())
}

/// Отчёт, резерв в настройках панели и что панель предложит. Предложения
/// нет, если в панели резерв уже не больше подобранного: нода ещё не
/// применила его, а tmnode до 0.7.0 и вовсе сравнивает с резервом из
/// окружения контейнера (нет `reserve_source` в отчёте), так что
/// предупреждение может остаться и после подбора.
async fn offer(
    state: &AppState,
    node_id: &str,
) -> ApiResult<(Option<Reading>, Option<u64>, Option<u64>)> {
    let reading = latest_reading(state, node_id).await?;
    let panel = desired::effective(&state.db, node_id)
        .await?
        .merged()
        .get(KEY)
        .copied();
    let suggested = reading
        .and_then(|r| r.suggestion())
        .filter(|s| panel.is_none_or(|p| p > *s));
    Ok((reading, panel, suggested))
}

/// `GET /nodes/{id}/blob-reserve` — место под файлы и что предложит панель.
pub async fn view(
    State(state): State<AppState>,
    _user: CurrentUser,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    node_name(&state, &id).await?;
    let (reading, panel, suggested) = offer(&state, &id).await?;
    Ok(Json(json!({
        "available_bytes": reading.map(|r| r.available),
        "total_bytes": reading.and_then(|r| r.total),
        "reserve_bytes": reading.map(|r| r.reserve),
        "suggested_bytes": suggested,
        "panel_bytes": panel,
        "managed": managed(&state, &id).await?,
    })))
}

/// `POST /nodes/{id}/blob-reserve` — подобрать резерв по последнему отчёту.
pub async fn apply(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    user.require(Role::Admin)?;
    let name = node_name(&state, &id).await?;
    if !managed(&state, &id).await? {
        return Err(ApiError::conflict(
            "у ноды нет агента tmnode — задайте BLOB_DISK_RESERVE_BYTES в окружении ноды",
        ));
    }
    let (Some(reading), _, Some(reserve)) = offer(&state, &id).await? else {
        return Err(ApiError::conflict(
            "по последнему отчёту места под файлы хватает — подбирать нечего",
        ));
    };
    set_override(&state, &id, reserve).await?;
    audit::record(
        &state.db,
        Actor::User(&user),
        "node.blob_reserve",
        Some(&name),
        json!({ "node_id": id, "from": reading.reserve, "to": reserve, "auto": false }),
    )
    .await?;
    Ok(Json(json!({ "reserve_bytes": reserve })))
}

/// После отчёта агента: если при подготовке ноды просили подобрать резерв —
/// подобрать один раз, по первому отчёту, где видно место под файлы.
pub async fn auto_after_report(
    state: &AppState,
    node_id: &str,
    report: &ReportIn,
    ip: ClientIp,
) -> ApiResult<()> {
    let row: Option<(String, Option<String>)> =
        sqlx::query_as("SELECT name, provision FROM nodes WHERE id = ?")
            .bind(node_id)
            .fetch_optional(&state.db)
            .await?;
    let Some((name, Some(raw))) = row else {
        return Ok(());
    };
    let Ok(mut provision) = serde_json::from_str::<Provision>(&raw) else {
        return Ok(());
    };
    if !provision.auto_blob_reserve {
        return Ok(());
    }
    // Пока контейнера нет, проверка пропущена — ждём следующего отчёта.
    let Some(reading) = Reading::from_checks(&report.checks) else {
        return Ok(());
    };
    provision.auto_blob_reserve = false;
    sqlx::query("UPDATE nodes SET provision = ? WHERE id = ?")
        .bind(serde_json::to_string(&provision).expect("provision serializes"))
        .bind(node_id)
        .execute(&state.db)
        .await?;
    let Some(reserve) = reading.suggestion() else {
        return Ok(());
    };
    set_override(state, node_id, reserve).await?;
    audit::record(
        &state.db,
        Actor::Named {
            id: None,
            username: "agent",
            ip: ip.0.as_deref(),
        },
        "node.blob_reserve",
        Some(&name),
        json!({ "node_id": node_id, "from": reading.reserve, "to": reserve, "auto": true }),
    )
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const GIB: u64 = 1 << 30;

    #[test]
    fn suggest_follows_disk_size() {
        // Маленький VPS: 13,5 ГиБ, свободно 4,4 — 10 % диска вниз до 256 МиБ.
        assert_eq!(suggest(14_483_001_344, 4_766_261_248), Some(1280 * MIB));
        // Крошечный диск — не меньше 512 МиБ.
        assert_eq!(suggest(2 * GIB, GIB + 1), Some(512 * MIB));
        // Большой диск — не больше 5 ГиБ.
        assert_eq!(suggest(500 * GIB, 400 * GIB), Some(5 * GIB));
    }

    #[test]
    fn suggest_leaves_room_for_files() {
        // По диску вышло бы 1,25 ГиБ, но свободно 1 ГиБ — половина свободного.
        assert_eq!(suggest(14 * GIB, GIB), Some(512 * MIB));
        // Почти полный диск: половина свободного меньше 512 МиБ — не подбираем.
        assert_eq!(suggest(14 * GIB, 900 * MIB), None);
        assert_eq!(suggest(14 * GIB, MIB), None);
    }

    fn check(id: &str, data: Value) -> CheckIn {
        serde_json::from_value(json!({ "id": id, "status": "warn", "summary": "", "data": data }))
            .unwrap()
    }

    #[test]
    fn reading_suggests_only_when_short() {
        let short = Reading::from_checks(&[
            check(
                "host.disk",
                json!({ "available_bytes": 4_766_261_248u64, "total_bytes": 14_483_001_344u64 }),
            ),
            check(
                "host.blob_reserve",
                json!({ "available_bytes": 4_766_261_248u64, "reserve_bytes": 5 * GIB }),
            ),
        ])
        .unwrap();
        assert_eq!(short.suggestion(), Some(1280 * MIB));

        let enough = Reading {
            available: 40 * GIB,
            reserve: 5 * GIB,
            total: Some(100 * GIB),
        };
        assert_eq!(enough.suggestion(), None);
        let no_total = Reading {
            total: None,
            ..short
        };
        assert_eq!(no_total.suggestion(), None);
        // Резерв уже меньше того, что подобрали бы, — не трогаем.
        let small = Reading {
            reserve: 256 * MIB,
            available: 200 * MIB,
            total: Some(14 * GIB),
        };
        assert_eq!(small.suggestion(), None);
        assert!(Reading::from_checks(&[]).is_none());
    }
}
