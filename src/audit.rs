//! Журнал действий. Пишется рядом с самим действием; секретов в `details`
//! не бывает.

use serde_json::Value;
use sqlx::SqlitePool;

use crate::auth::CurrentUser;
use crate::{new_id, now};

/// Кто сделал: вошедший пользователь, пользователь по имени (неудачный
/// вход) или система.
pub enum Actor<'a> {
    User(&'a CurrentUser),
    Named {
        id: Option<&'a str>,
        username: &'a str,
        ip: Option<&'a str>,
    },
}

pub async fn record(
    db: &SqlitePool,
    actor: Actor<'_>,
    action: &str,
    target: Option<&str>,
    details: Value,
) -> sqlx::Result<()> {
    let (user_id, username, ip) = match actor {
        Actor::User(user) => (
            Some(user.id.as_str()),
            Some(user.username.as_str()),
            user.ip.as_deref(),
        ),
        Actor::Named { id, username, ip } => (id, Some(username), ip),
    };
    sqlx::query(
        "INSERT INTO audit (id, at, user_id, username, action, target, details, ip)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(new_id())
    .bind(now() as i64)
    .bind(user_id)
    .bind(username)
    .bind(action)
    .bind(target)
    .bind(details.to_string())
    .bind(ip)
    .execute(db)
    .await?;
    Ok(())
}
