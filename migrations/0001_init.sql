-- Схема 1. Время — секунды Unix, идентификаторы — ULID, секреты — только хэши
-- (кроме TOTP: он зашифрован ключом из secret.key).

CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    -- NULL, пока приглашённый не задал пароль.
    password_hash TEXT,
    role          TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'viewer')),
    totp_secret   BLOB,
    -- Секрет, выданный /auth/totp/setup и ещё не подтверждённый кодом.
    totp_pending  BLOB,
    -- Последний принятый шаг TOTP: повтор того же кода не принимается.
    totp_last_step INTEGER,
    disabled      INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL,
    last_login_at INTEGER
);

CREATE TABLE sessions (
    token_hash   TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    user_agent   TEXT,
    ip           TEXT
);
CREATE INDEX sessions_user ON sessions (user_id);

-- Одноразовые ссылки: первичная настройка и приглашения.
CREATE TABLE one_time_tokens (
    token_hash TEXT PRIMARY KEY,
    kind       TEXT NOT NULL CHECK (kind IN ('setup', 'invite')),
    user_id    TEXT REFERENCES users (id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
);

CREATE TABLE nodes (
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    addr                TEXT NOT NULL UNIQUE,
    node_key            TEXT NOT NULL,
    labels              TEXT NOT NULL DEFAULT '{}',
    notes               TEXT NOT NULL DEFAULT '',
    ingest_token_hash   TEXT UNIQUE,
    probe_interval_secs INTEGER NOT NULL DEFAULT 60,
    paused              INTEGER NOT NULL DEFAULT 0,
    -- Последний вычисленный статус: по его смене пишется событие.
    last_status         TEXT NOT NULL DEFAULT 'unknown',
    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL
);

CREATE TABLE probes (
    id           TEXT PRIMARY KEY,
    node_id      TEXT NOT NULL REFERENCES nodes (id) ON DELETE CASCADE,
    at           INTEGER NOT NULL,
    ok           INTEGER NOT NULL,
    stage        TEXT,
    error        TEXT,
    connect_ms   INTEGER,
    handshake_ms INTEGER,
    config       TEXT
);
CREATE INDEX probes_node_at ON probes (node_id, at);
CREATE INDEX probes_at ON probes (at);

CREATE TABLE reports (
    id             TEXT PRIMARY KEY,
    node_id        TEXT NOT NULL REFERENCES nodes (id) ON DELETE CASCADE,
    received_at    INTEGER NOT NULL,
    generated_at   INTEGER NOT NULL,
    status         TEXT NOT NULL,
    counts         TEXT NOT NULL,
    tmnode_version TEXT NOT NULL,
    body           TEXT NOT NULL
);
CREATE INDEX reports_node_received ON reports (node_id, received_at);

CREATE TABLE events (
    id          TEXT PRIMARY KEY,
    at          INTEGER NOT NULL,
    node_id     TEXT NOT NULL REFERENCES nodes (id) ON DELETE CASCADE,
    kind        TEXT NOT NULL,
    from_status TEXT,
    to_status   TEXT,
    summary     TEXT NOT NULL
);
CREATE INDEX events_at ON events (at);

-- Журнал переживает удаление пользователя: имя хранится рядом с id.
CREATE TABLE audit (
    id       TEXT PRIMARY KEY,
    at       INTEGER NOT NULL,
    user_id  TEXT,
    username TEXT,
    action   TEXT NOT NULL,
    target   TEXT,
    details  TEXT NOT NULL DEFAULT '{}',
    ip       TEXT
);
CREATE INDEX audit_at ON audit (at);
