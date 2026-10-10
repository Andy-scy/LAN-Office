# AGENTS.md — AI Agent Handoff (必读 / READ THIS FIRST)

> 本文件是写给修改本项目的 AI Agent 的交接简报（README 置顶章节的镜像）。两处内容需保持同步：README.md 的 "AI Agent Handoff" 章节 + 本文件。
> Written for AI agents (Codex / Claude / Cursor / ...) that will modify this repo. English for precision; reply to the maintainer in Simplified Chinese.

## What this project is

LAN Office is a self-hosted, LAN-only collaborative Office suite for Windows: a Node.js server (file management, presence, persistence) that integrates **ONLYOFFICE Document Server** — an external AGPL process — as the actual `.docx` / `.xlsx` / `.pptx` editing engine, via its HTTP/JS API. No accounts; trusted-LAN threat model.

## Non-negotiable architecture facts

1. **Real editing comes ONLY from ONLYOFFICE Document Server** (separate process, installed by the user, default port 80). NEVER reimplement editing, format conversion, or co-editing: no HTML converters, no custom OT/CRDT, no "simplified" editors. The Node layer is glue, not an editor.
2. **UUID-keyed storage.** Clients address files ONLY by UUID; every path is resolved server-side from `data/documents/index.json` metadata. Any new endpoint must preserve this property — it is what structurally kills path traversal.
3. **`document.key` lifecycle** is `${id}_${version}`. Bump `version` ONLY when nobody is editing (`collaboration.editingCount(id) === 0`) at save time; otherwise live co-editing sessions split. Read `server/onlyoffice.js → applySavedCallback` before touching keys.
4. **The save pipeline is safety-critical and ordered**: DS callback (status 2/3/6/7) → download to `data/temp` → validate (non-empty, `PK` magic for OOXML) → snapshot previous file to `data/backups/<id>/` → atomic `renameSync` → conditional version bump. Do not reorder, parallelize, or skip steps.
5. **Permissions are enforced server-side** in `server/access.js`. Device identity = `x-lan-user` header (UUID from `localStorage`). When `settings.accessEnabled`, upload/create/rename/delete/restore/assign/survey-create are teacher-only. UI hiding is cosmetic; server checks are the authority.
6. **Single-teacher mode**: `access.authTeacher()` demotes every other teacher device. `/api/me` exposes `teacher: {name, dname}` so any device can display who is on duty.
7. **The browser client has no build step** — vanilla JS served statically from `public/`. Do not introduce frameworks, bundlers, npm packages, or TypeScript on the frontend.

## Module map

| Path | Responsibility |
|---|---|
| `server/index.js` | bootstrap: config → dirs → free-port scan (3000+) → banner (prints teacher password) |
| `server/config.js` | loads `config/config.json` over defaults; env overrides: `PORT`, `LANOFFICE_DATA_DIR`, `LANOFFICE_NO_OPEN`, `LANOFFICE_DS_DISABLE` |
| `server/network.js` | LAN IPv4 detection (filters virtual adapters, prefers 192.168.*) |
| `server/fileManager.js` | metadata store (`data/documents/index.json`), filename sanitization, unique-name, backup/restore |
| `server/collaboration.js` | in-memory presence: users/nicknames/devices/colors, per-file rooms |
| `server/onlyoffice.js` | DS healthcheck (probes 80/8080/8090/8000/8888), JWT (auto-reads DS `local.json`), editor-config builder, save callbacks, CommandService (`forcesave`, `meta`) |
| `server/access.js` | groups & permissions (`data/access.json`), single-teacher, file access matrix |
| `server/surveys.js` | survey storage (`data/surveys/*.json`) |
| `server/routes.js` | all REST endpoints; device auth via `x-lan-user` header |
| `server/websocket.js` | Socket.IO presence only — document content sync lives inside DS |
| `public/js/common.js` | shared client core: `App` global, `icon()` SVG set, user/device identity, device-kind sniffing (`<html data-device>`), `bottomSheet` |
| `scripts/test.js` | integration tests (78 assertions) |

## Hard-won traps (do not rediscover these)

- **cmd.exe + UTF-8 `.bat` = silently skipped lines.** `.bat` files MUST be GBK/CP936 encoded and must NOT enable `chcp 65001` before Chinese `echo` lines. Switch to 65001 only right before spawning node, then back to 936. Keep CRLF endings.
- **`crypto.randomUUID` is undefined on insecure origins** (`http://<lan-ip>` — how students actually connect). Client IDs must come from the `randomId()` fallback (`crypto.getRandomValues`); the server validates `/^[0-9a-f-]{8,64}$/i`, and `loadUser` auto-migrates legacy malformed IDs.
- **Multipart filenames arrive latin1-decoded** → run `fixUtf8Name()` and prefer the client-sent `names` JSON field; never trust raw `originalname` for CJK filenames.
- **`copyFileSync` on Windows preserves mtime** → backup filenames include milliseconds; a same-second collision once silently destroyed a backup.
- **JWT is ON by default** (DS ≥ 7.2). The server auto-reads `C:\Program Files\ONLYOFFICE\DocumentServer\config\local.json`; if that fails, users set `ds.jwtSecret` in `config/config.json`.
- **Port 80 is commonly squatted** on Chinese Windows (Steam++/Watt Toolkit accelerator). After install, move DS off 80 (nginx conf) and set `ds.url` in `config/config.json`; the server probes 80/8080/8090/8000/8888.
- **DS must reach the Node server**: callbacks default to `http://127.0.0.1:<port>` (`ds.callbackHost` for cross-host setups).
- **The user is a school teacher and a beginner.** Every UI string is Simplified Chinese; admin surfaces must stay beginner-proof; never ship features that require editing files by hand unless documented in `使用说明.txt`.

## Testing & release conventions

- `npm test` spawns its own server (port 3100) with an isolated data dir — 78 assertions; MUST be green before any commit to `main`. New endpoints need new assertions in `scripts/test.js`.
- Version bumps happen in THREE places together: `package.json`, `server/index.js`, `server/routes.js` (+ README badge).
- `config/config.json` in the repo is the default template. `data/` is runtime state and may contain user documents — never commit it or anything user-specific.
- Commits to `main` are made via the GitHub **Git Data API** (blob → tree → commit → update ref; the maintainer has no local git). Respect `.gitignore`: `data/`, `runtime/`, `node_modules/`, `downloads/`, `.impeccable/`, `onlyoffice-documentserver.exe`, `*.tmp`, `*.log`.
- Encodings: `.bat` → GBK + CRLF; `使用说明.txt` → UTF-8 with BOM + CRLF; everything else UTF-8 (LF fine).

## Language

User-facing strings: Simplified Chinese. Code comments: Chinese is fine. Replies to the maintainer: Simplified Chinese.
