# syntax=docker/dockerfile:1.6

# 1. Панель: статика для встраивания в бинарь.
FROM node:24-bookworm-slim AS web
RUN corepack enable
WORKDIR /web
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm build

# 2. Сервер. build-essential, cmake и perl нужны aws-lc-sys: его тянет
# зависимость trust_message_tcp (rustls), Rust их не требует.
FROM rust:1.97-slim-bookworm AS server
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential cmake perl pkg-config git \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY migrations ./migrations
COPY src ./src
COPY --from=web /web/dist ./web/dist
RUN cargo build --release --locked

# 3. Рантайм на той же дистрибуции, что сборка: бинарь слинкован с её glibc.
# ca-certificates — корни TLS для запросов к GitHub (релизы для обновления нод).
FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN useradd -u 10001 -r -m -d /srv/trustme-admin admin \
    && mkdir -p /srv/trustme-admin/data \
    && chown admin:admin /srv/trustme-admin/data
WORKDIR /srv/trustme-admin
COPY --from=server /app/target/release/trustme-admin /usr/local/bin/trustme-admin
USER admin
ENV RUST_LOG=info \
    TM_ADMIN_LISTEN=0.0.0.0:8088 \
    TM_ADMIN_DATA=/srv/trustme-admin/data
EXPOSE 8088
VOLUME ["/srv/trustme-admin/data"]
CMD ["trustme-admin"]
