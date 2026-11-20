# Dependency Status

This document tracks the ongoing effort to replace floating major-version
dependency declarations with exact pins. It is updated as each package is
stabilized; packages not listed here have not yet been addressed.

**Effort status:** in progress.

## Rust crates (`src-tauri/Cargo.toml`)

| Package | Pinned Version | Status | Last Verified |
| --- | --- | --- | --- |
| `serde_json` | `=1.0.154` | Pinned (was floating `1`, locked `1.0.151`) | 2026-11-21 |
| `log` | `=0.4.35` | Pinned (was floating `0.4`, locked `0.4.34`) | 2026-11-21 |
| `opener` | `=0.9.0` | Pinned (was `0.8`, locked `0.8.5`; 0.x minor bump, API verified) | 2026-11-21 |
| `rusqlite` | `=0.43.0` | Pinned (was `0.32`, locked `0.32.1`; high-risk 11-version 0.x jump, API verified; bundled SQLite 3.54.1 via libsqlite3-sys 0.40.0) | 2026-11-21 |

## npm packages (`package.json`)

| Package | Pinned Version | Status | Last Verified |
| --- | --- | --- | --- |
| `@mantine/core` | `9.8.2` | Pinned (lockstep patch bump 9.8.1→9.8.2) | 2026-11-21 |
| `@mantine/dates` | `9.8.2` | Pinned (lockstep patch bump 9.8.1→9.8.2) | 2026-11-21 |
| `@mantine/hooks` | `9.8.2` | Pinned (lockstep patch bump 9.8.1→9.8.2) | 2026-11-21 |
| `@mantine/notifications` | `9.8.2` | Pinned (lockstep patch bump 9.8.1→9.8.2) | 2026-11-21 |
| `@mantine/schedule` | `9.8.2` | Pinned (lockstep patch bump 9.8.1→9.8.2) | 2026-11-21 |
| `@types/bun` | `1.4.5` | Pinned (patch bump 1.4.4→1.4.5) | 2026-11-21 |
| `@codemirror/lang-markdown` | `6.5.2` | Pinned (removed caret range; version unchanged) | 2026-11-21 |
| `dayjs` | `1.11.23` | Pinned (removed caret range; version unchanged) | 2026-11-21 |
| `dompurify` | `3.4.18` | Pinned (removed caret range; version unchanged) | 2026-11-21 |
| `latest` | `0.2.0` | Pinned (removed caret range; version unchanged) | 2026-11-21 |

## Runtime (CI workflows)

| Package | Pinned Version | Status | Last Verified |
| --- | --- | --- | --- |
| Bun runtime | `1.4.5` | Pinned across all workflows (was 1.4.0/1.4.4) | 2026-11-21 |
| Rust toolchain | `1.100.0` | Pinned via `rust-toolchain.toml` (source of truth; was floating `stable`, local was 1.99.1) | 2026-11-21 |
