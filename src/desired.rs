//! Желаемые настройки ноды — `runtime.toml`, который агент кладёт на хост
//! (trustme_backend: docs/runtime-config.md, docs/agent-protocol.md).
//!
//! Собирается из профиля лимитов, переопределений ноды и назначенных ей
//! TURN-серверов. Версия — хэш содержимого: одинаковые настройки дают
//! одинаковую версию, и агент не переписывает файл зря.

use std::collections::BTreeMap;
use std::fmt::Write as _;

use anyhow::{Context, Result, anyhow};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use tmnode::protocol::RuntimeDoc;
use trust_message_tcp::runtime::RuntimeFile;
use trust_message_tcp::runtime::catalog;

use crate::crypto::SecretBox;
use crate::releases::{Version, image_version};

/// Потолок кадра ноды по умолчанию: им проверяются связанные настройки
/// (кусок файла должен влезать в кадр).
const MAX_FRAME_LEN: usize = 8 * 1024 * 1024;

pub type Settings = BTreeMap<String, u64>;

/// С какой версии нода знает настройку. Незнакомое имя в `runtime.toml`
/// нода не пропускает и отвергает весь файл, поэтому ноде старше такие
/// настройки не отдаются: она остаётся на своём умолчании.
const SINCE: &[(&str, Version)] = &[("queue_addressing_enabled", Version::new(0, 8, 0))];

/// Версия ноды, с которой она понимает настройку; `None` — понимает любая.
pub fn since(key: &str) -> Option<Version> {
    SINCE.iter().find(|(k, _)| *k == key).map(|(_, v)| *v)
}

/// Настройки, которые нода понимает, и ключи, для неё слишком новые. Версия
/// ноды неизвестна (тег без версии, агент не прислал образ) — отдаётся всё.
pub fn for_node(settings: Settings, node: Option<Version>) -> (Settings, Vec<String>) {
    let Some(node) = node else {
        return (settings, Vec::new());
    };
    let (kept, newer): (Settings, Settings) = settings
        .into_iter()
        .partition(|(key, _)| since(key).is_none_or(|v| node >= v));
    (kept, newer.into_keys().collect())
}

/// Проверить настройки по каталогу ноды и вместе — тем же разбором, что
/// сделает нода. Ошибка — текст для администратора.
pub fn check_settings(settings: &Settings) -> std::result::Result<(), String> {
    for (key, value) in settings {
        let setting = catalog::find(key).ok_or_else(|| format!("неизвестная настройка `{key}`"))?;
        setting.check(*value)?;
    }
    let file = RuntimeFile {
        version: None,
        settings: settings.clone(),
        ice: None,
    };
    file.overlay(&Default::default(), MAX_FRAME_LEN)
        .map(|_| ())
        .map_err(|e| format!("{e:#}"))
}

/// Один ICE-сервер в файле.
pub struct IceServer {
    pub urls: Vec<String>,
    pub secret: Option<String>,
}

/// Текст `runtime.toml` с версией.
pub fn render(settings: &Settings, ice: &[IceServer]) -> RuntimeDoc {
    let mut body = String::new();
    if !settings.is_empty() {
        body.push_str("\n[settings]\n");
        for (key, value) in settings {
            let _ = writeln!(body, "{key} = {value}");
        }
    }
    for server in ice {
        body.push_str("\n[[ice.servers]]\n");
        let urls: Vec<String> = server.urls.iter().map(|u| toml_string(u)).collect();
        let _ = writeln!(body, "urls = [{}]", urls.join(", "));
        if let Some(secret) = &server.secret {
            let _ = writeln!(body, "secret = {}", toml_string(secret));
        }
    }
    let version = hex::encode(&Sha256::digest(body.as_bytes())[..8]);
    RuntimeDoc {
        content: format!(
            "# Создано TrustMe Admin. Правьте настройки в панели: файл перезапишется.\n\
             version = \"{version}\"\n{body}"
        ),
        version,
    }
}

fn toml_string(value: &str) -> String {
    toml::Value::String(value.to_owned()).to_string()
}

/// Действующие лимиты ноды: профиль, поверх — переопределения.
pub struct Effective {
    pub profile_id: String,
    pub profile_name: String,
    pub profile: Settings,
    pub overrides: Settings,
}

impl Effective {
    pub fn merged(&self) -> Settings {
        let mut out = self.profile.clone();
        out.extend(self.overrides.clone());
        out
    }
}

pub fn parse_settings(text: &str) -> Settings {
    serde_json::from_str(text).unwrap_or_default()
}

pub async fn effective(db: &SqlitePool, node_id: &str) -> Result<Effective> {
    let (profile_id, overrides): (Option<String>, String) =
        sqlx::query_as("SELECT profile_id, overrides FROM nodes WHERE id = ?")
            .bind(node_id)
            .fetch_optional(db)
            .await?
            .ok_or_else(|| anyhow!("node {node_id} not found"))?;
    // Без своего профиля (или если его удалили) нода живёт на профиле по
    // умолчанию.
    let own: Option<(String, String, String)> = match profile_id {
        Some(id) => {
            sqlx::query_as("SELECT id, name, settings FROM limit_profiles WHERE id = ?")
                .bind(id)
                .fetch_optional(db)
                .await?
        }
        None => None,
    };
    let profile = match own {
        Some(profile) => profile,
        None => sqlx::query_as(
            "SELECT id, name, settings FROM limit_profiles WHERE is_default = 1 LIMIT 1",
        )
        .fetch_one(db)
        .await
        .context("default profile")?,
    };
    Ok(Effective {
        profile_id: profile.0,
        profile_name: profile.1,
        profile: parse_settings(&profile.2),
        overrides: parse_settings(&overrides),
    })
}

/// TURN-серверы ноды с открытыми секретами — только для файла ноды.
pub async fn ice_servers(
    db: &SqlitePool,
    secrets: &SecretBox,
    node_id: &str,
) -> Result<Vec<IceServer>> {
    let rows: Vec<(String, Option<Vec<u8>>)> = sqlx::query_as(
        "SELECT t.urls, t.secret FROM node_turn nt JOIN turn_servers t ON t.id = nt.turn_server_id
         WHERE nt.node_id = ? ORDER BY t.created_at, t.id",
    )
    .bind(node_id)
    .fetch_all(db)
    .await?;
    rows.into_iter()
        .map(|(urls, secret)| {
            Ok(IceServer {
                urls: serde_json::from_str(&urls).context("turn urls")?,
                secret: secret
                    .map(|sealed| {
                        secrets
                            .open(&sealed)
                            .and_then(|plain| String::from_utf8(plain.to_vec()).map_err(Into::into))
                    })
                    .transpose()?,
            })
        })
        .collect()
}

/// Образ ноды из последнего heartbeat агента.
pub async fn node_image(db: &SqlitePool, node_id: &str) -> Result<Option<String>> {
    let image: Option<Option<String>> =
        sqlx::query_scalar("SELECT node_image FROM agents WHERE node_id = ?")
            .bind(node_id)
            .fetch_optional(db)
            .await?;
    Ok(image.flatten())
}

pub struct Desired {
    pub doc: RuntimeDoc,
    /// Настройки профиля и переопределений, которых эта нода ещё не знает:
    /// в файл они не попали.
    pub skipped: Vec<String>,
}

/// Желаемый `runtime.toml` ноды. `image` — образ, на котором нода работает
/// или будет установлена: по его версии отсеиваются слишком новые настройки.
pub async fn desired(
    db: &SqlitePool,
    secrets: &SecretBox,
    node_id: &str,
    image: Option<&str>,
) -> Result<Desired> {
    let settings = effective(db, node_id).await?.merged();
    let (settings, skipped) = for_node(settings, image.and_then(image_version));
    let ice = ice_servers(db, secrets, node_id).await?;
    Ok(Desired {
        doc: render(&settings, &ice),
        skipped,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_is_deterministic_and_parses_on_the_node() {
        let mut settings = Settings::new();
        settings.insert("rate_limit_send_msgs_per_sec".into(), 40);
        settings.insert("ice_credential_ttl_secs".into(), 3600);
        let ice = [
            IceServer {
                urls: vec!["stun:turn.example.org:3478".into()],
                secret: None,
            },
            IceServer {
                urls: vec!["turn:turn.example.org:3478?transport=udp".into()],
                secret: Some("0123456789abcdef\"quoted".into()),
            },
        ];
        let a = render(&settings, &ice);
        let b = render(&settings, &ice);
        assert_eq!(a, b);
        let file = RuntimeFile::parse(&a.content).unwrap();
        assert_eq!(file.version.as_deref(), Some(a.version.as_str()));
        let t = file.overlay(&Default::default(), MAX_FRAME_LEN).unwrap();
        assert_eq!(t.limits.send_msgs_per_sec, 40);
        assert_eq!(
            t.ice.servers[1].secret.as_deref(),
            Some("0123456789abcdef\"quoted")
        );

        settings.insert("rate_limit_send_msgs_per_sec".into(), 41);
        assert_ne!(render(&settings, &ice).version, a.version);
        assert_eq!(render(&Settings::new(), &[]).version.len(), 16);
    }

    #[test]
    fn settings_are_checked_like_the_node_does() {
        let mut s = Settings::new();
        s.insert("nope".into(), 1);
        assert!(check_settings(&s).unwrap_err().contains("nope"));
        let mut s = Settings::new();
        s.insert("session_confirm_timeout_secs".into(), 0);
        assert!(check_settings(&s).is_err());
        let mut s = Settings::new();
        s.insert("tcp_keepalive_secs".into(), 60);
        s.insert("tcp_keepalive_interval_secs".into(), 0);
        assert!(check_settings(&s).is_err());
        let mut s = Settings::new();
        s.insert("limit_max_connections".into(), 0);
        assert!(check_settings(&s).is_ok());
        assert!(parse_settings("garbage").is_empty());
        let mut s = Settings::new();
        s.insert("queue_addressing_enabled".into(), 0);
        assert!(check_settings(&s).is_ok());
        s.insert("queue_addressing_enabled".into(), 2);
        assert!(check_settings(&s).is_err());
    }

    #[test]
    fn newer_settings_are_kept_from_older_nodes() {
        let mut s = Settings::new();
        s.insert("queue_addressing_enabled".into(), 0);
        s.insert("limit_max_connections".into(), 10);

        let (kept, skipped) = for_node(s.clone(), Some(Version::new(0, 7, 0)));
        assert_eq!(kept.keys().collect::<Vec<_>>(), ["limit_max_connections"]);
        assert_eq!(skipped, ["queue_addressing_enabled"]);
        // Файл без новой настройки старая нода примет.
        let file = RuntimeFile::parse(&render(&kept, &[]).content).unwrap();
        assert!(!file.settings.contains_key("queue_addressing_enabled"));

        for node in [
            Some(Version::new(0, 8, 0)),
            Some(Version::new(1, 0, 0)),
            None,
        ] {
            let (kept, skipped) = for_node(s.clone(), node);
            assert_eq!(kept, s, "{node:?}");
            assert!(skipped.is_empty());
        }
    }
}
