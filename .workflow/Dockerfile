FROM node:22-bookworm

ENV DEBIAN_FRONTEND=noninteractive

# Tauri build deps (webkit2gtk etc.), python for the orchestrator, xvfb in case you use tauri-driver
RUN apt-get update && apt-get install -y --no-install-recommends \
      git curl wget file ca-certificates build-essential pkg-config \
      python3 python3-yaml xvfb \
      libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

# Rust, installed world-readable so the container can run as any --user
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH
RUN curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable \
    && chmod -R a+rX /usr/local/rustup /usr/local/cargo

# JS tooling
RUN npm install -g repomix

# Playwright's OS-level libraries (needs root, so do it here). The browser itself is
# downloaded by the `setup` command in config.yaml, matching the project's Playwright version.
RUN npx -y playwright@latest install-deps chromium

# goose CLI (verify this against the current install docs)
RUN curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh \
    | GOOSE_BIN_DIR=/usr/local/bin CONFIGURE=false bash

WORKDIR /work
