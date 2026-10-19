//! Каталог лимитов ноды, профили лимитов и TURN-серверы.

use std::collections::BTreeMap;

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use serde::Deserialize;
use serde_json::{Value, json};
use trust_message_tcp::runtime::catalog;

use crate::audit::{self, Actor};
use crate::auth::{CurrentUser, Role};
use crate::desired::{Settings, check_settings, parse_settings};
use crate::error::{ApiError, ApiResult};
use crate::{AppState, new_id, now};

/// Каталог настроек ноды: группы, единицы, пределы, умолчания и когда
/// изменение вступает в силу.
pub async fn catalog(_user: CurrentUser) -> Json<Value> {
    Json(json!({ "settings": catalog::describe() }))
}

fn validated(settings: &Settings) -> ApiResult<()> {
    check_settings(settings).map_err(ApiError::invalid)
}

fn check_profile_name(name: &str) -> ApiResult<String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 64 {
        return Err(ApiError::invalid("name: от 1 до 64 символов"));
    }
    Ok(name.to_owned())
}

#[derive(sqlx::FromRow)]
struct ProfileRow {
    id: String,
    name: String,
    settings: String,
    is_default: bool,
    created_at: i64,
    updated_at: i64,
}

async fn profile_json(db: &sqlx::SqlitePool, row: ProfileRow) -> ApiResult<Value> {
    let nodes: i64 = if row.is_default {
        sqlx::query_scalar("SELECT COUNT(*) FROM nodes WHERE profile_id IS NULL OR profile_id = ?")
            .bind(&row.id)
            .fetch_one(db)
            .await?
    } else {
        sqlx::query_scalar("SELECT COUNT(*) FROM nodes WHERE profile_id = ?")
            .bind(&row.id)
            .fetch_one(db)
            .await?
    };
    Ok(json!({
        "id": row.id,
        "name": row.name,
        "settings": parse_settings(&row.settings),
        "is_default": row.is_default,
        "nodes": nodes,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }))
}

async fn profile_row(db: &sqlx::SqlitePool, id: &str) -> ApiResult<ProfileRow> {
    sqlx::query_as(
        "SELECT id, name, settings, is_default, created_at, updated_at FROM limit_profiles WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(db)
    .await?
    .ok_or_else(ApiError::not_found)
}

pub async fn list_profiles(
    State(state): State<AppState>,
    _user: CurrentUser,
) -> ApiResult<Json<Value>> {
    let rows: Vec<ProfileRow> = sqlx::query_as(
        "SELECT id, name, settings, is_default, created_at, updated_at FROM limit_profiles
         ORDER BY is_default DESC, name COLLATE NOCASE",
    )
    .fetch_all(&state.db)
    .await?;
    let mut profiles = Vec::new();
    for row in rows {
        profiles.push(profile_json(&state.db, row).await?);
    }
    Ok(Json(json!({ "profiles": profiles })))
}

#[derive(Deserialize)]
pub struct ProfileIn {
    name: Option<String>,
    settings: Option<Settings>,
}

/// Имя профиля без учёта регистра. `COLLATE NOCASE` SQLite складывает
/// только латиницу, а профили называют по-русски.
async fn name_taken(db: &sqlx::SqlitePool, name: &str, except: Option<&str>) -> ApiResult<bool> {
    let rows: Vec<(String, String)> = sqlx::query_as("SELECT id, name FROM limit_profiles")
        .fetch_all(db)
        .await?;
    let wanted = name.to_lowercase();
    Ok(rows
        .iter()
        .any(|(id, other)| Some(id.as_str()) != except && other.to_lowercase() == wanted))
}

fn unique_violation(err: &sqlx::Error) -> bool {
    matches!(err, sqlx::Error::Database(db) if db.is_unique_violation())
}

pub async fn create_profile(
    State(state): State<AppState>,
    user: CurrentUser,
    Json(input): Json<ProfileIn>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    user.require(Role::Admin)?;
    let name = check_profile_name(input.name.as_deref().unwrap_or(""))?;
    let settings = input.settings.unwrap_or_default();
    validated(&settings)?;
    if name_taken(&state.db, &name, None).await? {
        return Err(ApiError::conflict(format!("профиль «{name}» уже есть")));
    }
    let id = new_id();
    let now = now() as i64;
    let inserted = sqlx::query(
        "INSERT INTO limit_profiles (id, name, settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&name)
    .bind(serde_json::to_string(&settings).expect("settings serialize"))
    .bind(now)
    .bind(now)
    .execute(&state.db)
    .await;
    if let Err(err) = &inserted
        && unique_violation(err)
    {
        return Err(ApiError::conflict(format!("профиль «{name}» уже есть")));
    }
    inserted?;
    audit::record(
        &state.db,
        Actor::User(&user),
        "profile.created",
        Some(&name),
        json!({ "profile_id": id }),
    )
    .await?;
    let row = profile_row(&state.db, &id).await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({ "profile": profile_json(&state.db, row).await? })),
    ))
}

pub async fn update_profile(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<String>,
    Json(input): Json<ProfileIn>,
) -> ApiResult<Json<Value>> {
    user.require(Role::Admin)?;
    let row = profile_row(&state.db, &id).await?;
    let name = match &input.name {
        Some(name) => check_profile_name(name)?,
        None => row.name.clone(),
    };
    let settings = match &input.settings {
        Some(settings) => {
            validated(settings)?;
            settings.clone()
        }
        None => parse_settings(&row.settings),
    };
    if name_taken(&state.db, &name, Some(&id)).await? {
        return Err(ApiError::conflict(format!("профиль «{name}» уже есть")));
    }
    let updated = sqlx::query(
        "UPDATE limit_profiles SET name = ?, settings = ?, updated_at = ? WHERE id = ?",
    )
    .bind(&name)
    .bind(serde_json::to_string(&settings).expect("settings serialize"))
    .bind(now() as i64)
    .bind(&id)
    .execute(&state.db)
    .await;
    if let Err(err) = &updated
        && unique_violation(err)
    {
        return Err(ApiError::conflict(format!("профиль «{name}» уже есть")));
    }
    updated?;
    audit::record(
        &state.db,
        Actor::User(&user),
        "profile.updated",
        Some(&name),
        json!({ "profile_id": id, "settings": input.settings.is_some() }),
    )
    .await?;
    let row = profile_row(&state.db, &id).await?;
    Ok(Json(
        json!({ "profile": profile_json(&state.db, row).await? }),
    ))
}

pub async fn make_default(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    user.require(Role::Admin)?;
    let row = profile_row(&state.db, &id).await?;
    let mut tx = state.db.begin().await?;
    sqlx::query("UPDATE limit_profiles SET is_default = 0")
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE limit_profiles SET is_default = 1 WHERE id = ?")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    audit::record(
        &state.db,
        Actor::User(&user),
        "profile.made_default",
        Some(&row.name),
        json!({ "profile_id": id }),
    )
    .await?;
    let row = profile_row(&state.db, &id).await?;
    Ok(Json(
        json!({ "profile": profile_json(&state.db, row).await? }),
    ))
}

pub async fn delete_profile(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<String>,
) -> ApiResult<StatusCode> {
    user.require(Role::Admin)?;
    let row = profile_row(&state.db, &id).await?;
    if row.is_default {
        return Err(ApiError::conflict(
            "профиль по умолчанию удалить нельзя — сначала назначьте другой",
        ));
    }
    // Ноды этого профиля перейдут на профиль по умолчанию (ON DELETE SET NULL).
    sqlx::query("DELETE FROM limit_profiles WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await?;
    audit::record(
        &state.db,
        Actor::User(&user),
        "profile.deleted",
        Some(&row.name),
        json!({ "profile_id": id }),
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// URL ICE-сервера: те же правила, что проверит нода.
pub fn check_turn(urls: &[String], secret: Option<&str>) -> ApiResult<()> {
    let file = trust_message_tcp::runtime::RuntimeFile::parse(
        &crate::desired::render(
            &BTreeMap::new(),
            &[crate::desired::IceServer {
                urls: urls.to_vec(),
                secret: secret.map(str::to_owned),
            }],
        )
        .content,
    )
    .map_err(|e| ApiError::invalid(format!("{e:#}")))?;
    file.overlay(&Default::default(), 8 * 1024 * 1024)
        .map(|_| ())
        .map_err(|e| ApiError::invalid(format!("{e:#}").replace("ice.servers[0]: ", "")))
}

#[derive(sqlx::FromRow)]
struct TurnRow {
    id: String,
    name: String,
    urls: String,
    has_secret: bool,
    node_id: Option<String>,
    node_name: Option<String>,
    created_at: i64,
}

async fn turn_list(db: &sqlx::SqlitePool, where_id: Option<&str>) -> ApiResult<Vec<Value>> {
    let rows: Vec<TurnRow> = sqlx::query_as(
        "SELECT t.id, t.name, t.urls, t.secret IS NOT NULL AS has_secret, t.node_id,
                n.name AS node_name, t.created_at
         FROM turn_servers t LEFT JOIN nodes n ON n.id = t.node_id
         WHERE (?1 IS NULL OR t.id = ?1) ORDER BY t.created_at, t.id",
    )
    .bind(where_id)
    .fetch_all(db)
    .await?;
    let mut out = Vec::new();
    for row in rows {
        let used_by: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM node_turn WHERE turn_server_id = ?")
                .bind(&row.id)
                .fetch_one(db)
                .await?;
        out.push(json!({
            "id": row.id,
            "name": row.name,
            "urls": serde_json::from_str::<Value>(&row.urls).unwrap_or_else(|_| json!([])),
            "has_secret": row.has_secret,
            "managed_by_node": row.node_id.map(|id| json!({ "id": id, "name": row.node_name })),
            "nodes": used_by,
            "created_at": row.created_at,
        }));
    }
    Ok(out)
}

pub async fn list_turn(
    State(state): State<AppState>,
    _user: CurrentUser,
) -> ApiResult<Json<Value>> {
    Ok(Json(
        json!({ "turn_servers": turn_list(&state.db, None).await? }),
    ))
}

#[derive(Deserialize)]
pub struct TurnIn {
    name: Option<String>,
    urls: Option<Vec<String>>,
    /// `Some("")` — убрать секрет (сервер становится STUN).
    secret: Option<String>,
}

pub async fn create_turn(
    State(state): State<AppState>,
    user: CurrentUser,
    Json(input): Json<TurnIn>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    user.require(Role::Admin)?;
    let name = check_profile_name(input.name.as_deref().unwrap_or(""))?;
    let urls = input.urls.unwrap_or_default();
    let secret = input.secret.filter(|s| !s.trim().is_empty());
    check_turn(&urls, secret.as_deref())?;
    let id = new_id();
    let now = now() as i64;
    sqlx::query(
        "INSERT INTO turn_servers (id, name, urls, secret, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&name)
    .bind(serde_json::to_string(&urls).expect("urls serialize"))
    .bind(secret.as_ref().map(|s| state.secrets.seal(s.as_bytes())))
    .bind(now)
    .bind(now)
    .execute(&state.db)
    .await?;
    audit::record(
        &state.db,
        Actor::User(&user),
        "turn.created",
        Some(&name),
        json!({ "turn_server_id": id }),
    )
    .await?;
    let server = turn_list(&state.db, Some(&id)).await?.remove(0);
    Ok((StatusCode::CREATED, Json(json!({ "turn_server": server }))))
}

pub async fn update_turn(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<String>,
    Json(input): Json<TurnIn>,
) -> ApiResult<Json<Value>> {
    user.require(Role::Admin)?;
    let (name, urls, sealed): (String, String, Option<Vec<u8>>) =
        sqlx::query_as("SELECT name, urls, secret FROM turn_servers WHERE id = ?")
            .bind(&id)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(ApiError::not_found)?;
    let name = match &input.name {
        Some(n) => check_profile_name(n)?,
        None => name,
    };
    let urls: Vec<String> = match &input.urls {
        Some(u) => u.clone(),
        None => serde_json::from_str(&urls).unwrap_or_default(),
    };
    let secret: Option<String> = match &input.secret {
        Some(s) if s.trim().is_empty() => None,
        Some(s) => Some(s.clone()),
        None => sealed
            .map(|b| {
                state
                    .secrets
                    .open(&b)
                    .map(|p| String::from_utf8_lossy(&p).into_owned())
            })
            .transpose()?,
    };
    check_turn(&urls, secret.as_deref())?;
    sqlx::query(
        "UPDATE turn_servers SET name = ?, urls = ?, secret = ?, updated_at = ? WHERE id = ?",
    )
    .bind(&name)
    .bind(serde_json::to_string(&urls).expect("urls serialize"))
    .bind(secret.as_ref().map(|s| state.secrets.seal(s.as_bytes())))
    .bind(now() as i64)
    .bind(&id)
    .execute(&state.db)
    .await?;
    audit::record(
        &state.db,
        Actor::User(&user),
        "turn.updated",
        Some(&name),
        json!({ "turn_server_id": id, "secret_changed": input.secret.is_some() }),
    )
    .await?;
    Ok(Json(
        json!({ "turn_server": turn_list(&state.db, Some(&id)).await?.remove(0) }),
    ))
}

pub async fn delete_turn(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<String>,
) -> ApiResult<StatusCode> {
    user.require(Role::Admin)?;
    let (name, node_id): (String, Option<String>) =
        sqlx::query_as("SELECT name, node_id FROM turn_servers WHERE id = ?")
            .bind(&id)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(ApiError::not_found)?;
    if node_id.is_some() {
        return Err(ApiError::conflict(
            "coturn поставлен вместе с нодой: он удаляется вместе с ней или снимается с ноды",
        ));
    }
    sqlx::query("DELETE FROM turn_servers WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await?;
    audit::record(
        &state.db,
        Actor::User(&user),
        "turn.deleted",
        Some(&name),
        json!({ "turn_server_id": id }),
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}
