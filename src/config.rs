//! Настройки запуска: флаги командной строки поверх переменных окружения.

use std::net::SocketAddr;
use std::path::PathBuf;

use anyhow::{Context, Result, bail};

#[derive(Debug, Clone, PartialEq)]
pub struct Config {
    /// Где слушать (`TM_ADMIN_LISTEN`, `--listen`). Default: `127.0.0.1:8088` —
    /// наружу админку выставляют через прокси с TLS.
    pub listen: SocketAddr,
    /// Каталог данных: `admin.db` и `secret.key` (`TM_ADMIN_DATA`, `--data`).
    /// Default: `./data`.
    pub data_dir: PathBuf,
    /// Адрес, по которому админку открывают в браузере (`TM_ADMIN_PUBLIC_URL`):
    /// из него строится ссылка первичной настройки, а `https://` включает
    /// `Secure` у cookie. Default: `http://<listen>`.
    pub public_url: String,
    /// Доверять `X-Forwarded-For` (`TM_ADMIN_TRUST_PROXY`). Default: нет.
    pub trust_proxy: bool,
    /// Срок хранения проб, сутки (`TM_ADMIN_PROBE_RETENTION_DAYS`). Default: 14.
    pub probe_retention_days: u64,
    /// Образ ноды для новых установок (`TM_ADMIN_NODE_IMAGE`).
    /// Default: `ghcr.io/darkildo/trustme_backend:stable`.
    pub node_image: String,
}

pub const DEFAULT_NODE_IMAGE: &str = "ghcr.io/darkildo/trustme_backend:stable";

const USAGE: &str = "\
trustme-admin — панель управления нодами TrustMe

Использование: trustme-admin [--listen АДРЕС:ПОРТ] [--data КАТАЛОГ] [--public-url URL] [--trust-proxy]

Переменные окружения: TM_ADMIN_LISTEN, TM_ADMIN_DATA, TM_ADMIN_PUBLIC_URL,
TM_ADMIN_TRUST_PROXY, TM_ADMIN_PROBE_RETENTION_DAYS, TM_ADMIN_NODE_IMAGE, RUST_LOG.
";

pub enum Parsed {
    Run(Config),
    Help,
    Version,
}

impl Config {
    pub fn parse(
        args: impl IntoIterator<Item = String>,
        env: impl Fn(&str) -> Option<String>,
    ) -> Result<Parsed> {
        let mut listen = env("TM_ADMIN_LISTEN").unwrap_or_else(|| "127.0.0.1:8088".into());
        let mut data = env("TM_ADMIN_DATA").unwrap_or_else(|| "data".into());
        let mut public_url = env("TM_ADMIN_PUBLIC_URL");
        let mut trust_proxy = env("TM_ADMIN_TRUST_PROXY")
            .map(|v| parse_bool(&v))
            .transpose()?
            .unwrap_or(false);
        let probe_retention_days = env("TM_ADMIN_PROBE_RETENTION_DAYS")
            .map(|v| v.parse::<u64>().ok().filter(|d| (1..=365).contains(d)))
            .map(|v| v.context("TM_ADMIN_PROBE_RETENTION_DAYS: от 1 до 365"))
            .transpose()?
            .unwrap_or(14);
        let node_image = env("TM_ADMIN_NODE_IMAGE").unwrap_or_else(|| DEFAULT_NODE_IMAGE.into());

        let mut args = args.into_iter();
        while let Some(arg) = args.next() {
            let mut value = || {
                args.next()
                    .with_context(|| format!("{arg}: нужно значение"))
            };
            match arg.as_str() {
                "--listen" => listen = value()?,
                "--data" => data = value()?,
                "--public-url" => public_url = Some(value()?),
                "--trust-proxy" => trust_proxy = true,
                "--help" | "-h" => return Ok(Parsed::Help),
                "--version" | "-V" => return Ok(Parsed::Version),
                other => bail!("неизвестный аргумент `{other}`\n\n{USAGE}"),
            }
        }

        let listen: SocketAddr = listen
            .parse()
            .with_context(|| format!("адрес `{listen}`: ожидается IP:порт"))?;
        let public_url = public_url
            .unwrap_or_else(|| format!("http://{listen}"))
            .trim_end_matches('/')
            .to_owned();
        if !(public_url.starts_with("http://") || public_url.starts_with("https://")) {
            bail!("TM_ADMIN_PUBLIC_URL должен начинаться с http:// или https://");
        }
        Ok(Parsed::Run(Config {
            listen,
            data_dir: PathBuf::from(data),
            public_url,
            trust_proxy,
            probe_retention_days,
            node_image,
        }))
    }

    pub fn usage() -> &'static str {
        USAGE
    }

    pub fn secure_cookies(&self) -> bool {
        self.public_url.starts_with("https://")
    }
}

fn parse_bool(value: &str) -> Result<bool> {
    match value.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Ok(true),
        "0" | "false" | "no" | "off" | "" => Ok(false),
        other => bail!("ожидается true/false, получено `{other}`"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(args: &[&str], env: &[(&str, &str)]) -> Result<Parsed> {
        let env: Vec<(String, String)> = env
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        Config::parse(args.iter().map(|s| s.to_string()), move |k| {
            env.iter().find(|(key, _)| key == k).map(|(_, v)| v.clone())
        })
    }

    fn run(args: &[&str], env: &[(&str, &str)]) -> Config {
        match parse(args, env).unwrap() {
            Parsed::Run(c) => c,
            _ => panic!("expected run"),
        }
    }

    #[test]
    fn defaults_are_local_and_safe() {
        let c = run(&[], &[]);
        assert_eq!(c.listen.to_string(), "127.0.0.1:8088");
        assert_eq!(c.data_dir, PathBuf::from("data"));
        assert_eq!(c.public_url, "http://127.0.0.1:8088");
        assert!(!c.trust_proxy && !c.secure_cookies());
        assert_eq!(c.probe_retention_days, 14);
        assert_eq!(c.node_image, DEFAULT_NODE_IMAGE);
        assert_eq!(
            run(&[], &[("TM_ADMIN_NODE_IMAGE", "img:1")]).node_image,
            "img:1"
        );
    }

    #[test]
    fn flags_override_environment() {
        let c = run(
            &[
                "--listen",
                "0.0.0.0:9000",
                "--data",
                "/var/lib/tm",
                "--trust-proxy",
            ],
            &[
                ("TM_ADMIN_LISTEN", "127.0.0.1:1"),
                ("TM_ADMIN_PUBLIC_URL", "https://admin.example.org/"),
                ("TM_ADMIN_PROBE_RETENTION_DAYS", "30"),
            ],
        );
        assert_eq!(c.listen.to_string(), "0.0.0.0:9000");
        assert_eq!(c.data_dir, PathBuf::from("/var/lib/tm"));
        assert_eq!(c.public_url, "https://admin.example.org");
        assert!(c.secure_cookies() && c.trust_proxy);
        assert_eq!(c.probe_retention_days, 30);
        assert!(run(&[], &[("TM_ADMIN_TRUST_PROXY", "yes")]).trust_proxy);
    }

    #[test]
    fn bad_input_is_rejected() {
        assert!(parse(&["--listen", "nope"], &[]).is_err());
        assert!(parse(&["--listen"], &[]).is_err());
        assert!(parse(&["--bogus"], &[]).is_err());
        assert!(parse(&[], &[("TM_ADMIN_PUBLIC_URL", "ftp://x")]).is_err());
        assert!(parse(&[], &[("TM_ADMIN_TRUST_PROXY", "maybe")]).is_err());
        assert!(parse(&[], &[("TM_ADMIN_PROBE_RETENTION_DAYS", "0")]).is_err());
        assert!(matches!(parse(&["--help"], &[]).unwrap(), Parsed::Help));
        assert!(matches!(parse(&["-V"], &[]).unwrap(), Parsed::Version));
        assert!(Config::usage().contains("TM_ADMIN_LISTEN"));
    }
}
