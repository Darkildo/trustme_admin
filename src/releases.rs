//! Релизы бэкенда (`Darkildo/trustme_backend`) — версии, до которых панель
//! обновляет ноду и агента `tmnode` (docs/agent-protocol.md, «Обновление»).
//!
//! Список берётся из GitHub API, хэши бинарей `tmnode` — из ассета
//! `SHA256SUMS` релиза. Ответы кэшируются в памяти на несколько минут: без
//! токена GitHub пускает 60 запросов в час с адреса. Источник можно
//! выключить (офлайн-панель) — тогда версию и хэш администратор задаёт
//! вручную.

use std::collections::HashMap;
use std::fmt;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize, Serializer};

use crate::probe::BoxFuture;

/// Репозиторий релизов по умолчанию.
pub const DEFAULT_REPO: &str = "Darkildo/trustme_backend";
/// Архитектуры, под которые выпускается `tmnode`.
pub const ARCHES: [&str; 2] = ["x86_64", "aarch64"];
/// Сколько живёт ответ GitHub в кэше.
const CACHE_TTL: Duration = Duration::from_secs(5 * 60);
/// Сколько помнить ошибку — чтобы не долбить GitHub на каждый запрос панели.
const ERROR_TTL: Duration = Duration::from_secs(30);
/// Таймаут запроса к GitHub целиком.
const HTTP_TIMEOUT: Duration = Duration::from_secs(10);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// Предел `SHA256SUMS`: там две строки, больше — что-то не то.
const SUMS_LIMIT: usize = 64 * 1024;
/// Предел ответа со списком релизов.
const LIST_LIMIT: usize = 4 << 20;

/// Версия `X.Y.Z`; сравнение — семантическое (по числам, не по строкам).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Version {
    pub major: u64,
    pub minor: u64,
    pub patch: u64,
}

impl Version {
    pub const fn new(major: u64, minor: u64, patch: u64) -> Self {
        Self {
            major,
            minor,
            patch,
        }
    }

    /// Строго `X.Y.Z`, допускается `v` спереди. Pre-release и метки сборки
    /// (`1.0.0-rc1`, `1.0.0+abc`) не версии релиза — `None`.
    pub fn parse(s: &str) -> Option<Self> {
        let s = s.trim();
        let s = s.strip_prefix('v').unwrap_or(s);
        let mut parts = s.split('.');
        let mut num = || {
            let part = parts.next()?;
            let ok =
                !part.is_empty() && part.len() <= 9 && part.bytes().all(|b| b.is_ascii_digit());
            ok.then(|| part.parse().ok()).flatten()
        };
        let version = Self::new(num()?, num()?, num()?);
        parts.next().is_none().then_some(version)
    }

    /// Версия, которую прислал агент: `X.Y.Z` в начале, хвост вида `-dev`
    /// или `+abc` отбрасывается.
    pub fn parse_lenient(s: &str) -> Option<Self> {
        let s = s.trim();
        let s = s.strip_prefix('v').unwrap_or(s);
        let end = s
            .find(|c: char| !(c.is_ascii_digit() || c == '.'))
            .unwrap_or(s.len());
        Self::parse(&s[..end])
    }
}

impl fmt::Display for Version {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}.{}.{}", self.major, self.minor, self.patch)
    }
}

impl Serialize for Version {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.collect_str(self)
    }
}

/// Версия ноды по образу: `…/trustme_backend:v0.7.0` → 0.7.0. Тег без
/// версии (`stable`, `latest`) и образ без тега — `None`.
pub fn image_version(image: &str) -> Option<Version> {
    let image = image.split('@').next()?;
    let name = image.rsplit('/').next()?;
    let (_, tag) = name.split_once(':')?;
    Version::parse(tag)
}

/// Тот же образ с тегом версии: `…/trustme_backend:stable` → `…:v0.7.0`.
pub fn with_version(image: &str, version: Version) -> String {
    let image = image.split('@').next().unwrap_or(image);
    let name_start = image.rfind('/').map_or(0, |i| i + 1);
    let repo = match image[name_start..].find(':') {
        Some(i) => &image[..name_start + i],
        None => image,
    };
    format!("{repo}:v{version}")
}

/// `SHA256SUMS` в формате `sha256sum`: `<64 hex>  <имя>` (или ` *<имя>` в
/// двоичном режиме). Строки не по формату пропускаются.
pub fn parse_sha256sums(text: &str) -> HashMap<String, String> {
    text.lines()
        .filter_map(|line| {
            let (hash, name) = line.trim().split_once(char::is_whitespace)?;
            let name = name.trim_start();
            let name = name.strip_prefix('*').unwrap_or(name);
            let ok = hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit());
            (ok && !name.is_empty()).then(|| (name.to_owned(), hash.to_ascii_lowercase()))
        })
        .collect()
}

/// Имя бинаря `tmnode` в релизе.
pub fn tmnode_asset(arch: &str) -> String {
    format!("tmnode-{arch}-linux")
}

/// Выпущенный релиз `vX.Y.Z`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Release {
    pub version: Version,
    pub tag: String,
    /// Когда опубликован, секунды Unix.
    pub published_at: Option<u64>,
    /// Страница релиза.
    pub url: String,
    /// Архитектуры, под которые в релизе есть `tmnode-<arch>-linux`.
    pub tmnode_arches: Vec<String>,
    /// Адрес `SHA256SUMS`; `None` — в релизе его нет.
    #[serde(skip)]
    pub sums_url: Option<String>,
}

impl Release {
    /// Есть ли `tmnode` под архитектуру — и хэш, чтобы его проверить.
    pub fn has_tmnode(&self, arch: &str) -> bool {
        self.sums_url.is_some() && self.tmnode_arches.iter().any(|a| a == arch)
    }
}

#[derive(Deserialize)]
struct GhRelease {
    tag_name: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
    published_at: Option<String>,
    #[serde(default)]
    html_url: String,
    #[serde(default)]
    assets: Vec<GhAsset>,
}

#[derive(Deserialize)]
struct GhAsset {
    name: String,
    browser_download_url: String,
}

/// Ответ `GET /repos/{repo}/releases`: только выпущенные `vX.Y.Z` (без
/// черновиков и pre-release), новые первыми.
pub fn parse_github_releases(body: &[u8]) -> Result<Vec<Release>> {
    let raw: Vec<GhRelease> = serde_json::from_slice(body).context("ответ GitHub не разобран")?;
    let mut releases: Vec<Release> = raw
        .into_iter()
        .filter(|r| !r.draft && !r.prerelease && r.tag_name.starts_with('v'))
        .filter_map(|r| {
            let version = Version::parse(&r.tag_name)?;
            let tmnode_arches = ARCHES
                .iter()
                .filter(|arch| r.assets.iter().any(|a| a.name == tmnode_asset(arch)))
                .map(|arch| (*arch).to_owned())
                .collect();
            let sums_url = r
                .assets
                .iter()
                .find(|a| a.name == "SHA256SUMS")
                .map(|a| a.browser_download_url.clone());
            Some(Release {
                version,
                published_at: r.published_at.as_deref().and_then(parse_rfc3339),
                tag: r.tag_name,
                url: r.html_url,
                tmnode_arches,
                sums_url,
            })
        })
        .collect();
    releases.sort_by_key(|r| std::cmp::Reverse(r.version));
    releases.dedup_by_key(|r| r.version);
    Ok(releases)
}

/// `2026-10-18T12:34:56Z` → секунды Unix. GitHub отдаёт время только в UTC.
fn parse_rfc3339(s: &str) -> Option<u64> {
    let (date, time) = s.trim().strip_suffix('Z')?.split_once('T')?;
    let mut d = date.split('-').map(|p| p.parse::<i64>().ok());
    let (y, m, day) = (d.next()??, d.next()??, d.next()??);
    let time = time.split('.').next()?;
    let mut t = time.split(':').map(|p| p.parse::<i64>().ok());
    let (h, min, sec) = (t.next()??, t.next()??, t.next()??);
    if !(1..=12).contains(&m) || !(1..=31).contains(&day) || h > 23 || min > 59 || sec > 60 {
        return None;
    }
    // Дни от 1970-01-01 по григорианскому календарю (алгоритм Хиннанта).
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    u64::try_from(days * 86_400 + h * 3600 + min * 60 + sec).ok()
}

/// Откуда брать релизы. Настоящий ходит в GitHub; тесты подставляют свой.
pub trait ReleaseSource: Send + Sync {
    /// Выпущенные релизы, новые первыми.
    fn releases(&self) -> BoxFuture<'_, Result<Vec<Release>>>;
    /// Содержимое `SHA256SUMS` релиза.
    fn sha256sums<'a>(&'a self, release: &'a Release) -> BoxFuture<'a, Result<String>>;
}

/// GitHub API без токена: релизы публичного репозитория.
pub struct GitHub {
    client: reqwest::Client,
    repo: String,
}

impl GitHub {
    pub fn new(repo: &str) -> Result<Self> {
        let client = reqwest::Client::builder()
            .user_agent(concat!("trustme-admin/", env!("CARGO_PKG_VERSION")))
            .timeout(HTTP_TIMEOUT)
            .connect_timeout(CONNECT_TIMEOUT)
            .build()
            .context("HTTP-клиент для GitHub")?;
        Ok(Self {
            client,
            repo: repo.to_owned(),
        })
    }

    async fn get(&self, url: &str, limit: usize) -> Result<Vec<u8>> {
        let mut response = self
            .client
            .get(url)
            .header(reqwest::header::ACCEPT, "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .send()
            .await
            .context("GitHub недоступен")?;
        let status = response.status();
        if !status.is_success() {
            bail!("GitHub ответил {status}");
        }
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await.context("ответ GitHub оборвался")?
        {
            if body.len() + chunk.len() > limit {
                bail!("ответ GitHub больше {limit} байт");
            }
            body.extend_from_slice(&chunk);
        }
        Ok(body)
    }
}

impl ReleaseSource for GitHub {
    fn releases(&self) -> BoxFuture<'_, Result<Vec<Release>>> {
        Box::pin(async move {
            let url = format!(
                "https://api.github.com/repos/{}/releases?per_page=100",
                self.repo
            );
            parse_github_releases(&self.get(&url, LIST_LIMIT).await?)
        })
    }

    fn sha256sums<'a>(&'a self, release: &'a Release) -> BoxFuture<'a, Result<String>> {
        Box::pin(async move {
            let url = release
                .sums_url
                .as_deref()
                .with_context(|| format!("в релизе {} нет SHA256SUMS", release.tag))?;
            let body = self.get(url, SUMS_LIMIT).await?;
            String::from_utf8(body).context("SHA256SUMS — не текст")
        })
    }
}

struct Cached<T> {
    at: Instant,
    value: Result<T, String>,
}

impl<T: Clone> Cached<T> {
    fn fresh(&self) -> Option<Result<T, String>> {
        let ttl = if self.value.is_ok() {
            CACHE_TTL
        } else {
            ERROR_TTL
        };
        (self.at.elapsed() < ttl).then(|| self.value.clone())
    }
}

type Sums = Arc<HashMap<String, String>>;

/// Релизы с кэшем. Выключенный источник (`disabled`) ничего не знает о
/// релизах: версии задаются вручную.
pub struct Releases {
    repo: Option<String>,
    source: Option<Arc<dyn ReleaseSource>>,
    list: Mutex<Option<Cached<Arc<Vec<Release>>>>>,
    sums: Mutex<HashMap<String, Cached<Sums>>>,
}

impl Releases {
    pub fn disabled() -> Self {
        Self {
            repo: None,
            source: None,
            list: Mutex::new(None),
            sums: Mutex::new(HashMap::new()),
        }
    }

    pub fn new(repo: &str, source: Arc<dyn ReleaseSource>) -> Self {
        Self {
            repo: Some(repo.to_owned()),
            source: Some(source),
            ..Self::disabled()
        }
    }

    pub fn github(repo: &str) -> Result<Self> {
        Ok(Self::new(repo, Arc::new(GitHub::new(repo)?)))
    }

    pub fn enabled(&self) -> bool {
        self.source.is_some()
    }

    pub fn repo(&self) -> Option<&str> {
        self.repo.as_deref()
    }

    /// Релизы, новые первыми. Ошибка — текст для человека.
    pub async fn list(&self) -> Result<Arc<Vec<Release>>, String> {
        let Some(source) = &self.source else {
            return Ok(Arc::default());
        };
        if let Some(hit) = self
            .list
            .lock()
            .expect("releases lock")
            .as_ref()
            .and_then(Cached::fresh)
        {
            return hit;
        }
        let value = source
            .releases()
            .await
            .map(Arc::new)
            .map_err(|e| format!("{e:#}"));
        if let Err(err) = &value {
            tracing::warn!(error = %err, "releases are unavailable");
        }
        *self.list.lock().expect("releases lock") = Some(Cached {
            at: Instant::now(),
            value: value.clone(),
        });
        value
    }

    /// Релиз с этой версией.
    pub async fn find(&self, version: Version) -> Result<Option<Release>, String> {
        Ok(self
            .list()
            .await?
            .iter()
            .find(|r| r.version == version)
            .cloned())
    }

    /// SHA-256 `tmnode-<arch>-linux` из `SHA256SUMS` релиза; `None` — в
    /// релизе такого бинаря нет.
    pub async fn tmnode_sha256(
        &self,
        release: &Release,
        arch: &str,
    ) -> Result<Option<String>, String> {
        let Some(source) = &self.source else {
            return Ok(None);
        };
        let cached = self
            .sums
            .lock()
            .expect("sums lock")
            .get(&release.tag)
            .and_then(Cached::fresh);
        let sums = match cached {
            Some(hit) => hit?,
            None => {
                let value = source
                    .sha256sums(release)
                    .await
                    .map(|text| Arc::new(parse_sha256sums(&text)))
                    .map_err(|e| format!("{e:#}"));
                self.sums.lock().expect("sums lock").insert(
                    release.tag.clone(),
                    Cached {
                        at: Instant::now(),
                        value: value.clone(),
                    },
                );
                value?
            }
        };
        Ok(sums.get(&tmnode_asset(arch)).cloned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_compare_by_numbers() {
        let v = |s| Version::parse(s).unwrap();
        assert_eq!(v("v0.7.0"), Version::new(0, 7, 0));
        assert!(v("0.10.0") > v("0.9.9"));
        assert!(v("1.0.0") > v("0.99.99"));
        assert!(v("0.6.1") > v("0.6.0"));
        assert_eq!(v("0.6.0").to_string(), "0.6.0");
        for bad in [
            "",
            "0.7",
            "0.7.0.1",
            "0.7.0-rc1",
            "0.7.0+abc",
            "v",
            "a.b.c",
            "0..1",
            " 1.2.x",
        ] {
            assert!(Version::parse(bad).is_none(), "{bad}");
        }
        assert_eq!(
            Version::parse_lenient("0.3.0-dev"),
            Some(Version::new(0, 3, 0))
        );
        assert_eq!(
            Version::parse_lenient("v0.2.1"),
            Some(Version::new(0, 2, 1))
        );
        assert_eq!(Version::parse_lenient("unknown"), None);
    }

    #[test]
    fn image_tags_carry_the_node_version() {
        assert_eq!(
            image_version("ghcr.io/darkildo/trustme_backend:v0.7.0"),
            Some(Version::new(0, 7, 0))
        );
        assert_eq!(
            image_version("localhost:5000/trustme_backend:v0.6.1@sha256:abc"),
            Some(Version::new(0, 6, 1))
        );
        assert_eq!(
            image_version("ghcr.io/darkildo/trustme_backend:stable"),
            None
        );
        assert_eq!(image_version("localhost:5000/trustme_backend"), None);
        assert_eq!(image_version(""), None);
        let v = Version::new(0, 7, 1);
        assert_eq!(
            with_version("ghcr.io/darkildo/trustme_backend:stable", v),
            "ghcr.io/darkildo/trustme_backend:v0.7.1"
        );
        assert_eq!(
            with_version("localhost:5000/trustme_backend@sha256:abc", v),
            "localhost:5000/trustme_backend:v0.7.1"
        );
        assert_eq!(with_version("trustme", v), "trustme:v0.7.1");
    }

    #[test]
    fn sha256sums_are_parsed() {
        let a = "a".repeat(64);
        let b = "B".repeat(64);
        let text = format!(
            "{a}  tmnode-aarch64-linux\n{b} *tmnode-x86_64-linux\n\nмусор\n{}  short\n",
            "c".repeat(10)
        );
        let sums = parse_sha256sums(&text);
        assert_eq!(sums.len(), 2);
        assert_eq!(sums["tmnode-aarch64-linux"], a);
        assert_eq!(sums["tmnode-x86_64-linux"], "b".repeat(64));
    }

    #[test]
    fn github_releases_are_filtered_and_sorted() {
        let asset = |name: &str| serde_json::json!({ "name": name, "browser_download_url": format!("https://dl/{name}") });
        let body = serde_json::json!([
            { "tag_name": "v0.6.0", "published_at": "2026-10-18T12:00:00Z", "html_url": "https://gh/v0.6.0",
              "assets": [asset("tmnode-x86_64-linux"), asset("tmnode-aarch64-linux"), asset("SHA256SUMS")] },
            { "tag_name": "v0.10.0", "published_at": "2026-11-01T00:00:00Z",
              "assets": [asset("tmnode-x86_64-linux"), asset("SHA256SUMS")] },
            { "tag_name": "v0.11.0-rc1", "prerelease": false },
            { "tag_name": "v0.12.0", "prerelease": true },
            { "tag_name": "v0.13.0", "draft": true },
            { "tag_name": "nightly" },
            { "tag_name": "v0.2.0" }
        ]);
        let releases = parse_github_releases(body.to_string().as_bytes()).unwrap();
        let tags: Vec<&str> = releases.iter().map(|r| r.tag.as_str()).collect();
        assert_eq!(tags, ["v0.10.0", "v0.6.0", "v0.2.0"]);
        assert_eq!(releases[1].published_at, Some(1_792_324_800));
        assert_eq!(releases[1].tmnode_arches, ["x86_64", "aarch64"]);
        assert!(releases[0].has_tmnode("x86_64") && !releases[0].has_tmnode("aarch64"));
        assert!(
            !releases[2].has_tmnode("x86_64"),
            "без бинарей и SHA256SUMS"
        );
        assert!(parse_github_releases(b"{}").is_err());
    }

    #[test]
    fn rfc3339_in_utc() {
        assert_eq!(parse_rfc3339("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_rfc3339("2000-03-01T00:00:00Z"), Some(951_868_800));
        assert_eq!(parse_rfc3339("2026-10-18T12:00:00.5Z"), Some(1_792_324_800));
        assert_eq!(parse_rfc3339("2026-10-18T12:00:00+03:00"), None);
        assert_eq!(parse_rfc3339("2026-13-18T12:00:00Z"), None);
    }

    struct Counting(std::sync::atomic::AtomicUsize);

    impl ReleaseSource for Counting {
        fn releases(&self) -> BoxFuture<'_, Result<Vec<Release>>> {
            self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Box::pin(async {
                Ok(vec![Release {
                    version: Version::new(0, 7, 0),
                    tag: "v0.7.0".into(),
                    published_at: None,
                    url: String::new(),
                    tmnode_arches: vec!["x86_64".into()],
                    sums_url: Some("sums".into()),
                }])
            })
        }

        fn sha256sums<'a>(&'a self, _: &'a Release) -> BoxFuture<'a, Result<String>> {
            self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Box::pin(async { Ok(format!("{}  tmnode-x86_64-linux\n", "d".repeat(64))) })
        }
    }

    #[tokio::test]
    async fn answers_are_cached() {
        let source = Arc::new(Counting(Default::default()));
        let releases = Releases::new(DEFAULT_REPO, source.clone());
        let release = releases.find(Version::new(0, 7, 0)).await.unwrap().unwrap();
        releases.list().await.unwrap();
        let sha = releases.tmnode_sha256(&release, "x86_64").await.unwrap();
        assert_eq!(sha, Some("d".repeat(64)));
        assert_eq!(releases.tmnode_sha256(&release, "aarch64").await, Ok(None));
        assert_eq!(source.0.load(std::sync::atomic::Ordering::SeqCst), 2);

        let off = Releases::disabled();
        assert!(!off.enabled() && off.list().await.unwrap().is_empty());
    }
}
