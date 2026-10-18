//! SQLite: открытие, миграции, чистка истории.

use std::path::Path;
use std::str::FromStr;
use std::time::Duration;

use anyhow::{Context, Result};
use sqlx::SqlitePool;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};

/// Сколько отчётов хранится на ноду.
pub const REPORTS_PER_NODE: i64 = 500;

pub async fn open(path: &Path) -> Result<SqlitePool> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .foreign_keys(true)
        .busy_timeout(Duration::from_secs(5));
    connect(options).await
}

/// База в памяти — для тестов.
pub async fn open_in_memory() -> Result<SqlitePool> {
    let options = SqliteConnectOptions::from_str("sqlite::memory:")?.foreign_keys(true);
    // Одно соединение: у каждого соединения к `:memory:` своя база.
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await?;
    migrate(&pool).await?;
    Ok(pool)
}

async fn connect(options: SqliteConnectOptions) -> Result<SqlitePool> {
    let pool = SqlitePoolOptions::new()
        .max_connections(8)
        .connect_with(options)
        .await
        .context("open SQLite")?;
    migrate(&pool).await?;
    Ok(pool)
}

async fn migrate(pool: &SqlitePool) -> Result<()> {
    sqlx::migrate!("./migrations")
        .run(pool)
        .await
        .context("apply migrations")
}

/// Чистка: старые пробы, лишние отчёты, истёкшие сессии и ссылки.
pub async fn prune(pool: &SqlitePool, now: u64, probe_retention_days: u64) -> Result<()> {
    let now = now as i64;
    sqlx::query("DELETE FROM probes WHERE at < ?")
        .bind(now - probe_retention_days as i64 * 86_400)
        .execute(pool)
        .await?;
    sqlx::query(
        "DELETE FROM reports WHERE id IN (
             SELECT id FROM (
                 SELECT id, ROW_NUMBER() OVER (PARTITION BY node_id ORDER BY received_at DESC, id DESC) AS n
                 FROM reports
             ) WHERE n > ?
         )",
    )
    .bind(REPORTS_PER_NODE)
    .execute(pool)
    .await?;
    sqlx::query("DELETE FROM events WHERE at < ?")
        .bind(now - 30 * 86_400)
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM sessions WHERE last_seen_at < ? OR created_at < ?")
        .bind(now - crate::auth::SESSION_IDLE_SECS as i64)
        .bind(now - crate::auth::SESSION_MAX_SECS as i64)
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM one_time_tokens WHERE expires_at < ?")
        .bind(now)
        .execute(pool)
        .await?;
    Ok(())
}
