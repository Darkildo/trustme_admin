//! Случайные токены, хэши и шифрование TOTP-секретов.

use std::path::Path;

use anyhow::{Context, Result, anyhow, bail};
use argon2::Argon2;
use argon2::password_hash::phc::PasswordHash;
use argon2::password_hash::{PasswordHasher, PasswordVerifier};
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

const NONCE_LEN: usize = 12;

pub fn random_bytes<const N: usize>() -> [u8; N] {
    let mut out = [0u8; N];
    getrandom::fill(&mut out).expect("operating system randomness");
    out
}

/// Токен для человека и машины: префикс говорит, что это (`tms_` — сессия,
/// `tmi_` — приём отчётов, `tmo_` — одноразовая ссылка), дальше 32 байта.
pub fn new_token(prefix: &str) -> String {
    format!("{prefix}{}", hex::encode(random_bytes::<32>()))
}

/// В базе токены лежат только хэшем: утечка базы не даёт войти.
pub fn token_hash(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

pub fn hash_password(password: &str) -> Result<String> {
    Argon2::default()
        .hash_password(password.as_bytes())
        .map(|hash| hash.to_string())
        .map_err(|err| anyhow!("argon2: {err}"))
}

pub fn verify_password(password: &str, phc: &str) -> bool {
    PasswordHash::new(phc)
        .map(|hash| {
            Argon2::default()
                .verify_password(password.as_bytes(), &hash)
                .is_ok()
        })
        .unwrap_or(false)
}

/// Ключ шифрования TOTP-секретов. Лежит файлом рядом с базой: копия базы без
/// него TOTP-секретов не раскрывает.
#[derive(Clone)]
pub struct SecretBox {
    cipher: ChaCha20Poly1305,
}

impl SecretBox {
    /// Прочитать ключ из `path` или создать его (права 0600).
    pub fn load_or_create(path: &Path) -> Result<Self> {
        let key = if path.exists() {
            let raw = Zeroizing::new(
                std::fs::read_to_string(path)
                    .with_context(|| format!("read {}", path.display()))?,
            );
            let bytes = Zeroizing::new(
                hex::decode(raw.trim())
                    .with_context(|| format!("{} is not hex", path.display()))?,
            );
            if bytes.len() != 32 {
                bail!("{} must hold 32 bytes", path.display());
            }
            let mut key = [0u8; 32];
            key.copy_from_slice(&bytes);
            key
        } else {
            let key = random_bytes::<32>();
            write_private(path, hex::encode(key).as_bytes())?;
            key
        };
        Ok(Self::from_key(key))
    }

    pub fn from_key(key: [u8; 32]) -> Self {
        let key = Zeroizing::new(key);
        Self {
            cipher: ChaCha20Poly1305::new(&Key::from(*key)),
        }
    }

    pub fn seal(&self, plain: &[u8]) -> Vec<u8> {
        let nonce_bytes = random_bytes::<NONCE_LEN>();
        let nonce = Nonce::from(nonce_bytes);
        let mut out = nonce_bytes.to_vec();
        out.extend(
            self.cipher
                .encrypt(&nonce, plain)
                .expect("chacha20poly1305 encryption cannot fail"),
        );
        out
    }

    pub fn open(&self, sealed: &[u8]) -> Result<Zeroizing<Vec<u8>>> {
        if sealed.len() < NONCE_LEN {
            bail!("sealed value too short");
        }
        let (nonce, body) = sealed.split_at(NONCE_LEN);
        let nonce: [u8; NONCE_LEN] = nonce.try_into().expect("split at NONCE_LEN");
        self.cipher
            .decrypt(&Nonce::from(nonce), body)
            .map(Zeroizing::new)
            .map_err(|_| anyhow!("sealed value does not open with secret.key"))
    }
}

/// Создать файл, доступный только владельцу, сразу с нужными правами.
pub fn write_private(path: &Path, bytes: &[u8]) -> Result<()> {
    use std::io::Write;
    #[cfg(unix)]
    use std::os::unix::fs::OpenOptionsExt;

    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options
        .open(path)
        .with_context(|| format!("create {}", path.display()))?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passwords_hash_and_verify() {
        let hash = hash_password("correct horse").unwrap();
        assert!(hash.starts_with("$argon2id$"));
        assert!(verify_password("correct horse", &hash));
        assert!(!verify_password("wrong horse", &hash));
        assert!(!verify_password("x", "not a phc string"));
    }

    #[test]
    fn tokens_are_prefixed_and_hashed() {
        let token = new_token("tmi_");
        assert!(token.starts_with("tmi_") && token.len() == 4 + 64);
        assert_ne!(token, new_token("tmi_"));
        assert_eq!(token_hash(&token).len(), 64);
        assert_eq!(token_hash(&token), token_hash(&token));
    }

    #[test]
    fn secret_box_round_trips_and_persists() {
        let dir =
            std::env::temp_dir().join(format!("tm_admin_box_{}", hex::encode(random_bytes::<8>())));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("secret.key");

        let first = SecretBox::load_or_create(&path).unwrap();
        let sealed = first.seal(b"JBSWY3DPEHPK3PXP");
        let second = SecretBox::load_or_create(&path).unwrap();
        assert_eq!(
            second.open(&sealed).unwrap().as_slice(),
            b"JBSWY3DPEHPK3PXP"
        );

        let other = SecretBox::from_key([1u8; 32]);
        assert!(other.open(&sealed).is_err());
        assert!(other.open(b"short").is_err());

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }

        std::fs::write(dir.join("bad.key"), "zz").unwrap();
        assert!(SecretBox::load_or_create(&dir.join("bad.key")).is_err());
        std::fs::write(dir.join("short.key"), "00ff").unwrap();
        assert!(SecretBox::load_or_create(&dir.join("short.key")).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
