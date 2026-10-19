//! Установка ноды по SSH из панели (docs/PROMPT.md, этап 6).
//!
//! Админка один раз подключается к серверу и запускает ту же команду
//! установки, что администратор вставил бы руками. Учётные данные живут
//! только на время задачи: в базу и в лог они не попадают, а после
//! подключения затираются.
//!
//! Пароль для `sudo` идёт через stdin канала, а не в командной строке:
//! её видят `ps` и журналы на сервере.

use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result, anyhow, bail};
use russh::client;
use russh::keys::{HashAlg, PrivateKeyWithHashAlg, PublicKeyOrCertificate, decode_secret_key};
use russh::{ChannelMsg, Disconnect};
use zeroize::Zeroizing;

use crate::api::INSTALL_SCRIPT;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
/// Установка с нуля (Docker, образы) идёт минуты; больше — что-то не так.
pub const INSTALL_TIMEOUT: Duration = Duration::from_secs(20 * 60);

pub enum Auth {
    Password(Zeroizing<String>),
    Key {
        pem: Zeroizing<String>,
        passphrase: Option<Zeroizing<String>>,
    },
}

pub struct Target {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: Auth,
    /// Пароль `sudo`, если пользователь не root. Для входа по паролю по
    /// умолчанию — тот же пароль.
    pub sudo_password: Option<Zeroizing<String>>,
    /// Ожидаемый отпечаток ключа хоста (`SHA256:…`). Без него ключ
    /// принимается при первом контакте и показывается в журнале задачи.
    pub host_fingerprint: Option<String>,
}

/// Команда на сервере. `enroll_args` — `--url … --token …`.
pub fn remote_command(username: &str, enroll_args: &str) -> String {
    let fetch = format!("T=$(mktemp) && curl -fsSL {INSTALL_SCRIPT} -o \"$T\"");
    let run = if username == "root" {
        format!("sh \"$T\" enroll {enroll_args}")
    } else {
        // Пароль приходит в stdin; -p '' — без приглашения в выводе.
        format!("sudo -S -p '' sh \"$T\" enroll {enroll_args}")
    };
    format!("{fetch} && {run}; rc=$?; rm -f \"$T\"; exit $rc")
}

struct Handler {
    expected: Option<String>,
    seen: Arc<std::sync::Mutex<Option<String>>>,
}

impl client::Handler for Handler {
    type Error = anyhow::Error;

    async fn check_server_key(
        &mut self,
        key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let fingerprint = match key {
            PublicKeyOrCertificate::PublicKey { key, .. } => key.fingerprint(HashAlg::Sha256),
            PublicKeyOrCertificate::Certificate(cert) => {
                cert.public_key().fingerprint(HashAlg::Sha256)
            }
        }
        .to_string();
        *self.seen.lock().expect("fingerprint lock") = Some(fingerprint.clone());
        match &self.expected {
            Some(expected) if expected.trim() != fingerprint => Err(anyhow!(
                "ключ хоста {fingerprint} не совпадает с ожидаемым {expected}"
            )),
            _ => Ok(true),
        }
    }
}

/// Подключиться, запустить установку и отдавать вывод в `out`.
/// Возвращает код выхода команды.
pub async fn install(target: Target, enroll_args: &str, mut out: impl FnMut(&str)) -> Result<u32> {
    let seen = Arc::new(std::sync::Mutex::new(None));
    let handler = Handler {
        expected: target.host_fingerprint.clone(),
        seen: seen.clone(),
    };
    let config = Arc::new(client::Config {
        inactivity_timeout: Some(Duration::from_secs(120)),
        ..Default::default()
    });
    let addr = (target.host.as_str(), target.port);
    let mut session = tokio::time::timeout(CONNECT_TIMEOUT, client::connect(config, addr, handler))
        .await
        .map_err(|_| {
            anyhow!(
                "нет соединения с {}:{} за {CONNECT_TIMEOUT:?}",
                target.host,
                target.port
            )
        })?
        .with_context(|| format!("SSH {}:{}", target.host, target.port))?;
    if let Some(fp) = seen.lock().expect("fingerprint lock").clone() {
        out(&format!("ключ хоста: {fp}\n"));
    }

    let sudo_password = match (&target.auth, &target.sudo_password) {
        (_, Some(sudo)) => Some(sudo.clone()),
        (Auth::Password(password), None) => Some(password.clone()),
        (Auth::Key { .. }, None) => None,
    };
    let authenticated = match target.auth {
        Auth::Password(password) => {
            session
                .authenticate_password(target.username.clone(), password.as_str())
                .await?
        }
        Auth::Key { pem, passphrase } => {
            let key = decode_secret_key(&pem, passphrase.as_ref().map(|p| p.as_str()))
                .context("закрытый ключ не читается (или неверная парольная фраза)")?;
            let hash = session.best_supported_rsa_hash().await?.flatten();
            session
                .authenticate_publickey(
                    target.username.clone(),
                    PrivateKeyWithHashAlg::new(Arc::new(key), hash),
                )
                .await?
        }
    };
    if !authenticated.success() {
        bail!("SSH: вход не принят — проверьте пользователя и пароль или ключ");
    }
    out(&format!("вход выполнен как {}\n", target.username));

    let mut channel = session.channel_open_session().await?;
    channel
        .exec(true, remote_command(&target.username, enroll_args))
        .await?;
    if target.username != "root"
        && let Some(password) = sudo_password
    {
        let line = Zeroizing::new(format!("{}\n", password.as_str()));
        channel.data(line.as_bytes()).await?;
    }
    channel.eof().await?;

    let mut code = None;
    let run = async {
        while let Some(msg) = channel.wait().await {
            match msg {
                ChannelMsg::Data { data } | ChannelMsg::ExtendedData { data, .. } => {
                    out(&String::from_utf8_lossy(&data));
                }
                ChannelMsg::ExitStatus { exit_status } => code = Some(exit_status),
                _ => {}
            }
        }
    };
    tokio::time::timeout(INSTALL_TIMEOUT, run)
        .await
        .map_err(|_| anyhow!("установка не закончилась за {INSTALL_TIMEOUT:?}"))?;
    let _ = session
        .disconnect(Disconnect::ByApplication, "", "en")
        .await;
    code.ok_or_else(|| anyhow!("сервер не вернул код выхода"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commands_use_sudo_only_for_non_root() {
        let root = remote_command("root", "--url https://a --token tme_x");
        assert!(root.contains("sh \"$T\" enroll --url https://a --token tme_x"));
        assert!(!root.contains("sudo"));
        let user = remote_command("deploy", "--url https://a --token tme_x");
        assert!(user.contains("sudo -S -p '' sh \"$T\" enroll"));
        assert!(user.ends_with("exit $rc"));
        assert!(user.contains(INSTALL_SCRIPT));
    }
}
