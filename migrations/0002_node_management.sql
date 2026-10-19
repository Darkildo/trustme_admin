-- Схема 2: управление нодами — профили лимитов, TURN-серверы, агенты.
--
-- Таблица nodes не пересоздаётся: при включённых внешних ключах DROP TABLE
-- каскадно стёр бы историю проб и отчётов. У подготовленной, но ещё не
-- установленной ноды node_key — пустая строка: ключ сообщит агент.

CREATE TABLE limit_profiles (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    -- Лимиты каталога ноды: имя → число. Чего нет — умолчание ноды.
    settings   TEXT NOT NULL DEFAULT '{}',
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
INSERT INTO limit_profiles (id, name, settings, is_default, created_at, updated_at)
VALUES ('default', 'По умолчанию', '{}', 1, 0, 0);

ALTER TABLE nodes ADD COLUMN profile_id TEXT REFERENCES limit_profiles (id) ON DELETE SET NULL;
-- Переопределения лимитов этой ноды поверх профиля: имя → число.
ALTER TABLE nodes ADD COLUMN overrides TEXT NOT NULL DEFAULT '{}';
-- Задание на установку (JSON): адрес, порт, бэкенд, ставить ли coturn.
-- NULL — нода добавлена вручную, по адресу и пину.
ALTER TABLE nodes ADD COLUMN provision TEXT;

CREATE TABLE turn_servers (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    -- JSON-массив stun:/turn: URL.
    urls       TEXT NOT NULL,
    -- static-auth-secret coturn, зашифрован secret.key. NULL — STUN.
    secret     BLOB,
    -- coturn, поставленный вместе с этой нодой; NULL — внешний сервер.
    node_id    TEXT REFERENCES nodes (id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE node_turn (
    node_id        TEXT NOT NULL REFERENCES nodes (id) ON DELETE CASCADE,
    turn_server_id TEXT NOT NULL REFERENCES turn_servers (id) ON DELETE CASCADE,
    PRIMARY KEY (node_id, turn_server_id)
);

-- Одноразовые токены подключения агента (tme_…).
CREATE TABLE enroll_tokens (
    token_hash TEXT PRIMARY KEY,
    node_id    TEXT NOT NULL REFERENCES nodes (id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE agents (
    id             TEXT PRIMARY KEY,
    node_id        TEXT NOT NULL UNIQUE REFERENCES nodes (id) ON DELETE CASCADE,
    token_hash     TEXT NOT NULL UNIQUE,
    hostname       TEXT NOT NULL,
    arch           TEXT NOT NULL,
    tmnode_version TEXT NOT NULL,
    enrolled_at    INTEGER NOT NULL,
    last_seen_at   INTEGER,
    -- runtime.status.json ноды из последнего heartbeat.
    runtime_status TEXT
);
