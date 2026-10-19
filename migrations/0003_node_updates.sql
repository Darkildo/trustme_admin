-- Схема 3: обновление ноды и агента tmnode из панели
-- (trustme_backend: docs/agent-protocol.md, «Обновление»).
--
-- Таблица agents не пересоздаётся, только дополняется: пересоздание при
-- включённых внешних ключах тянет каскады, а историю здесь терять нельзя.

-- Образ, на котором запущен контейнер ноды, из последнего heartbeat
-- (`ghcr.io/darkildo/trustme_backend:v0.7.0`). NULL — агент до 0.3.0 его не
-- присылает.
ALTER TABLE agents ADD COLUMN node_image TEXT;

CREATE TABLE node_updates (
    -- ULID строчными: агент возвращает id в статусе как есть.
    id              TEXT PRIMARY KEY,
    node_id         TEXT NOT NULL REFERENCES nodes (id) ON DELETE CASCADE,
    -- Целевая версия ноды X.Y.Z; NULL — контейнер ноды не трогать.
    node_version    TEXT,
    -- Целевая версия tmnode X.Y.Z и SHA-256 бинаря под архитектуру агента
    -- (из SHA256SUMS релиза или введённый вручную); NULL — агент не трогать.
    tmnode_version  TEXT,
    tmnode_sha256   TEXT,
    allow_downgrade INTEGER NOT NULL DEFAULT 0,
    -- pending — ждёт агента; running — агент выполняет; дальше итог агента
    -- (succeeded / failed / rolled_back / refused) или панели: cancelled —
    -- отменено до начала, lost — агент замолчал посреди обновления.
    state           TEXT NOT NULL DEFAULT 'pending' CHECK (state IN (
                        'pending', 'running', 'succeeded', 'failed',
                        'rolled_back', 'refused', 'cancelled', 'lost')),
    -- Шаг из статуса агента (check, download_tmnode, …, rollback).
    step            TEXT,
    -- Причина для человека: от агента или от панели (lost).
    error           TEXT,
    -- Что стояло до обновления и что стоит после (или вернулось после
    -- отката) — из статуса агента.
    from_node_image TEXT,
    to_node_image   TEXT,
    from_tmnode     TEXT,
    to_tmnode       TEXT,
    -- Имя пользователя, который запустил обновление.
    created_by      TEXT,
    created_at      INTEGER NOT NULL,
    -- Время панели: первый статус агента, итог, последний статус по заданию.
    started_at      INTEGER,
    finished_at     INTEGER,
    reported_at     INTEGER,
    CHECK (node_version IS NOT NULL OR tmnode_version IS NOT NULL),
    CHECK ((tmnode_version IS NULL) = (tmnode_sha256 IS NULL))
);

-- Одновременно у ноды не больше одного активного задания.
CREATE UNIQUE INDEX node_updates_active ON node_updates (node_id)
    WHERE state IN ('pending', 'running');
CREATE INDEX node_updates_history ON node_updates (node_id, created_at);
