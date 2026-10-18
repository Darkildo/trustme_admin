//! Пробы нод снаружи — путём клиента (`trust_message_tcp::net::probe`) — и
//! их расписание.

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tokio::sync::Semaphore;

use crate::{new_id, now, status};

/// Предел каждого сетевого шага пробы.
pub const STEP_TIMEOUT: Duration = Duration::from_secs(5);
/// Сколько проб идёт одновременно.
const PARALLEL_PROBES: usize = 16;
/// Как часто планировщик смотрит, кому пора.
const TICK: Duration = Duration::from_secs(5);

/// Что запоминается из подписанного `ServerConfig`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProbeConfig {
    pub proto_version: u32,
    pub expires_at: u64,
    pub supports_delivery_ack: bool,
    pub supports_queue_addressing: bool,
    pub supports_blobs: bool,
    pub blob_max_size: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ProbeResult {
    pub ok: bool,
    /// Этап, на котором проба остановилась (`connect` / `handshake` /
    /// `auth` / `config`).
    pub stage: Option<&'static str>,
    pub error: Option<String>,
    pub connect_ms: Option<u64>,
    pub handshake_ms: Option<u64>,
    pub config: Option<ProbeConfig>,
}

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Источник проб. Настоящий ходит в сеть; тесты подставляют свой.
pub trait Prober: Send + Sync {
    fn probe<'a>(&'a self, addr: &'a str, node_key: [u8; 32]) -> BoxFuture<'a, ProbeResult>;
}

/// Проба по сети тем же путём, что клиент: TCP, Noise IK с пином, вход
/// одноразовым ключом, подписанный конфиг.
pub struct NetProber;

impl Prober for NetProber {
    fn probe<'a>(&'a self, addr: &'a str, node_key: [u8; 32]) -> BoxFuture<'a, ProbeResult> {
        Box::pin(async move {
            match trust_message_tcp::net::probe::probe(addr, &node_key, STEP_TIMEOUT).await {
                Ok(outcome) => {
                    let cfg = outcome.config;
                    ProbeResult {
                        ok: true,
                        stage: None,
                        error: None,
                        connect_ms: Some(outcome.connect_time.as_millis() as u64),
                        handshake_ms: Some(outcome.handshake_time.as_millis() as u64),
                        config: Some(ProbeConfig {
                            proto_version: cfg.proto_version,
                            expires_at: cfg.expires_at,
                            supports_delivery_ack: cfg.supports_delivery_ack,
                            supports_queue_addressing: cfg.supports_queue_addressing,
                            supports_blobs: cfg.supports_blobs,
                            blob_max_size: cfg.blob_max_size,
                        }),
                    }
                }
                Err(err) => ProbeResult {
                    ok: false,
                    stage: Some(err.stage.as_str()),
                    error: Some(format!("{:#}", err.error)),
                    connect_ms: None,
                    handshake_ms: None,
                    config: None,
                },
            }
        })
    }
}

/// Проверить ноду, записать пробу и пересчитать статус.
pub async fn run_and_record(
    db: &SqlitePool,
    prober: &dyn Prober,
    node_id: &str,
    addr: &str,
    node_key: &str,
) -> anyhow::Result<(String, u64, ProbeResult)> {
    let key: [u8; 32] = hex::decode(node_key)
        .ok()
        .and_then(|b| b.try_into().ok())
        .ok_or_else(|| anyhow::anyhow!("node {node_id} has a malformed key"))?;
    let result = prober.probe(addr, key).await;
    let at = now();
    let id = new_id();
    sqlx::query(
        "INSERT INTO probes (id, node_id, at, ok, stage, error, connect_ms, handshake_ms, config)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(node_id)
    .bind(at as i64)
    .bind(result.ok)
    .bind(result.stage)
    .bind(&result.error)
    .bind(result.connect_ms.map(|v| v as i64))
    .bind(result.handshake_ms.map(|v| v as i64))
    .bind(
        result
            .config
            .as_ref()
            .map(|c| serde_json::to_string(c).expect("config serializes")),
    )
    .execute(db)
    .await?;
    status::refresh(db, node_id, at).await?;
    Ok((id, at, result))
}

/// Планировщик: каждые несколько секунд проверяет ноды, которым пора.
pub fn spawn_scheduler(db: SqlitePool, prober: Arc<dyn Prober>) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let limit = Arc::new(Semaphore::new(PARALLEL_PROBES));
        // Когда нода проверялась в последний раз (или проверка уже идёт).
        let mut last_run: HashMap<String, u64> = HashMap::new();
        loop {
            if let Err(err) = tick(&db, &prober, &limit, &mut last_run).await {
                tracing::warn!(error = %err, "probe scheduler tick failed");
            }
            tokio::time::sleep(TICK).await;
        }
    })
}

async fn tick(
    db: &SqlitePool,
    prober: &Arc<dyn Prober>,
    limit: &Arc<Semaphore>,
    last_run: &mut HashMap<String, u64>,
) -> sqlx::Result<()> {
    let nodes: Vec<(String, String, String, i64, Option<i64>)> = sqlx::query_as(
        "SELECT n.id, n.addr, n.node_key, n.probe_interval_secs,
                (SELECT MAX(at) FROM probes p WHERE p.node_id = n.id)
         FROM nodes n WHERE n.paused = 0",
    )
    .fetch_all(db)
    .await?;
    let now = now();
    last_run.retain(|id, _| nodes.iter().any(|n| &n.0 == id));
    for (id, addr, key, interval, last_probe) in nodes {
        let last = last_run
            .get(&id)
            .copied()
            .max(last_probe.map(|v| v as u64))
            .unwrap_or(0);
        if now < last + interval as u64 {
            continue;
        }
        last_run.insert(id.clone(), now);
        let (db, prober, limit) = (db.clone(), prober.clone(), limit.clone());
        tokio::spawn(async move {
            let Ok(_permit) = limit.acquire_owned().await else {
                return;
            };
            if let Err(err) = run_and_record(&db, prober.as_ref(), &id, &addr, &key).await {
                tracing::warn!(node = %id, error = format!("{err:#}"), "probe failed to record");
            }
        });
    }
    Ok(())
}

/// Раз в час: чистка истории и пересчёт статусов (отчёт мог устареть).
pub fn spawn_housekeeping(
    db: SqlitePool,
    probe_retention_days: u64,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(3600));
        loop {
            interval.tick().await;
            let now = now();
            if let Err(err) = crate::db::prune(&db, now, probe_retention_days).await {
                tracing::warn!(error = format!("{err:#}"), "pruning failed");
            }
            if let Err(err) = status::refresh_all(&db, now).await {
                tracing::warn!(error = %err, "status refresh failed");
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn net_prober_reports_the_failing_stage() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap().to_string();
        drop(listener);
        let result = NetProber.probe(&addr, [7u8; 32]).await;
        assert!(!result.ok);
        assert_eq!(result.stage, Some("connect"));
        assert!(result.error.unwrap().contains("connect"));
        assert!(result.config.is_none());
    }
}
