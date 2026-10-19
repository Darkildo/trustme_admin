use std::net::SocketAddr;
use std::sync::Arc;

use anyhow::{Context, Result};
use tracing_subscriber::EnvFilter;
use trustme_admin::config::{Config, Parsed};
use trustme_admin::crypto::SecretBox;
use trustme_admin::probe::{NetProber, Prober, spawn_housekeeping, spawn_scheduler};
use trustme_admin::releases::Releases;
use trustme_admin::{AppState, api, app, db};

#[tokio::main]
async fn main() -> Result<()> {
    let config = match Config::parse(std::env::args().skip(1), |k| std::env::var(k).ok())? {
        Parsed::Run(config) => config,
        Parsed::Help => {
            print!("{}", Config::usage());
            return Ok(());
        }
        Parsed::Version => {
            println!("trustme-admin {}", env!("CARGO_PKG_VERSION"));
            return Ok(());
        }
    };
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    std::fs::create_dir_all(&config.data_dir)
        .with_context(|| format!("create {}", config.data_dir.display()))?;
    let pool = db::open(&config.data_dir.join("admin.db")).await?;
    let secrets = SecretBox::load_or_create(&config.data_dir.join("secret.key"))?;
    let prober: Arc<dyn Prober> = Arc::new(NetProber);
    let state = AppState::new(pool.clone(), secrets, prober.clone())
        .with_options(config.secure_cookies(), config.trust_proxy)
        .with_deployment(&config.public_url, &config.node_image)
        .with_releases(match &config.releases_repo {
            Some(repo) => Releases::github(repo)?,
            None => {
                tracing::info!("релизы выключены (TM_ADMIN_RELEASES_REPO=off): версии обновлений задаются вручную");
                Releases::disabled()
            }
        });

    if let Some(token) = api::ensure_setup_token(&pool).await? {
        // Ссылка одноразовая и живёт сутки: это единственный способ завести
        // первого владельца, поэтому она и печатается.
        tracing::warn!(
            "первичная настройка: откройте {}/setup?token={token}",
            config.public_url
        );
    }
    if !config.listen.ip().is_loopback() && !config.secure_cookies() {
        tracing::warn!(
            listen = %config.listen,
            "панель доступна снаружи без HTTPS: поставьте перед ней прокси с TLS и задайте TM_ADMIN_PUBLIC_URL=https://…"
        );
    }

    spawn_scheduler(pool.clone(), prober);
    spawn_housekeeping(pool, config.probe_retention_days);

    let listener = tokio::net::TcpListener::bind(config.listen)
        .await
        .with_context(|| format!("bind {}", config.listen))?;
    tracing::info!(listen = %config.listen, version = env!("CARGO_PKG_VERSION"), "trustme-admin started");
    axum::serve(
        listener,
        app(state).into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(async {
        let _ = tokio::signal::ctrl_c().await;
    })
    .await?;
    Ok(())
}
