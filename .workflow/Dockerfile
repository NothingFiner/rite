FROM node:22-bookworm

ENV DEBIAN_FRONTEND=noninteractive

# Tauri build deps (webkit2gtk etc.), python for the orchestrator, xvfb in case you use tauri-driver.
# The 4.1 / libsoup-3.0 generation is deliberate: this app is Tauri v2
# (Cargo.toml: tauri = "2" -> webkit2gtk 2.x + soup3-sys), and soup3-sys builds
# against `libsoup-3.0`. The 4.0 stack is Tauri v1 only and leaves `cargo test`
# failing with "Package 'libsoup-3.0' ... not found" (the mirror of the note that
# used to be here, which said to swap these three when the app moved to v2).
RUN apt-get update && apt-get install -y --no-install-recommends \
      git curl wget file ca-certificates build-essential pkg-config \
      python3 python3-yaml xvfb \
      libwebkit2gtk-4.1-dev libjavascriptcoregtk-4.1-dev libsoup-3.0-dev \
      libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

# Rust, installed world-readable so the container can run as any --user
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH
RUN curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable \
    && chmod -R a+rX /usr/local/rustup /usr/local/cargo

# JS tooling. npm is pinned to 11 on purpose: node:22 ships npm 10, which both
# rejects this repo's lockfile (`npm ci` -> EUSAGE, "Missing: esbuild@0.28.2")
# and crashes resolving it ("Cannot read properties of null (reading 'edgesOut')"
# in arborist #loadPeerSet). npm 11 regenerates the same lock byte-identically and
# installs it cleanly, so the lock is right and the image was the odd one out.
# Keep this in step with the npm major developers use on the host.
RUN npm install -g npm@11 && npm install -g repomix

# Playwright's OS-level libraries (needs root, so do it here). The browser itself is
# downloaded by the `setup` command in config.yaml, matching the project's Playwright version.
RUN npx -y playwright@latest install-deps chromium

# goose CLI (verify this against the current install docs)
RUN curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh \
    | GOOSE_BIN_DIR=/usr/local/bin CONFIGURE=false bash

WORKDIR /work
