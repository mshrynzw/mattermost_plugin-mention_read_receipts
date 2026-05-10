# Mention Read Receipts

[![Build Status](https://github.com/mattermost/mattermost-plugin-starter-template/actions/workflows/ci.yml/badge.svg)](https://github.com/mattermost/mattermost-plugin-starter-template/actions/workflows/ci.yml)
[![E2E Status](https://github.com/mattermost/mattermost-plugin-starter-template/actions/workflows/e2e.yml/badge.svg)](https://github.com/mattermost/mattermost-plugin-starter-template/actions/workflows/e2e.yml)

**Mention Read Receipts** is a Mattermost plugin that shows **who has read posts you authored**, but only for readers who were part of the **mention audience** of that post. It works in **direct messages, group messages, and public channels**.

When someone eligible scrolls a message into view (above a visibility threshold), the plugin records a read receipt. **Authors** see a compact **“Read: user1, user2, …”** line under their own posts when at least one receipt exists.

<img width="1400" height="664" alt="image" src="https://github.com/user-attachments/assets/25be51d2-76a4-4efb-b713-fa01da4f2d2e" />

---

## Table of contents

- [Mention Read Receipts](#mention-read-receipts)
  - [Table of contents](#table-of-contents)
  - [Features](#features)
  - [Who can record a read receipt?](#who-can-record-a-read-receipt)
  - [What authors see](#what-authors-see)
  - [Privacy and access control](#privacy-and-access-control)
  - [Technical behavior and limitations](#technical-behavior-and-limitations)
  - [Requirements](#requirements)
    - [Mattermost Server](#mattermost-server)
    - [Toolchain (build from source)](#toolchain-build-from-source)
  - [Installation](#installation)
  - [Architecture overview](#architecture-overview)
    - [Server](#server)
    - [Web application](#web-application)
  - [HTTP API](#http-api)
    - [`POST /read-receipts/mark`](#post-read-receiptsmark)
    - [`GET /read-receipts`](#get-read-receipts)
  - [WebSocket events](#websocket-events)
  - [Development](#development)
    - [Prerequisites](#prerequisites)
    - [Sync generated manifest files](#sync-generated-manifest-files)
    - [Enable plugin uploads (local / dev)](#enable-plugin-uploads-local--dev)
    - [Deploy with local mode (`make deploy`)](#deploy-with-local-mode-make-deploy)
    - [Watch mode (webapp + redeploy)](#watch-mode-webapp--redeploy)
    - [Deploy with username/password or token](#deploy-with-usernamepassword-or-token)
    - [Debug webapp bundle](#debug-webapp-bundle)
  - [Building and versioning](#building-and-versioning)
  - [Releasing](#releasing)
  - [Forking this repository](#forking-this-repository)
  - [License](#license)
  - [Further reading](#further-reading)

---

## Features

- **Author-only summary**: Only the **sender** of a post sees read receipts for that post (others do not see the list via the plugin UI).
- **Mention-scoped eligibility**: Read receipts are recorded **only** when the viewer is in the **mention audience** (see below). If a post has **no** qualifying mentions, **no** receipts are stored when people read it.
- **Broadcast mentions**: `@channel`, `@all`, and `@here` are treated as targeting **everyone in the channel**, so any channel member may generate a receipt when reading.
- **Explicit mentions**: User IDs from `post.props["mentions"]` (plus `@username` parsing in the message text, resolved via the server API) align server-side enforcement with what clients send.
- **Real-time updates**: After a receipt is stored, the server broadcasts a **custom WebSocket event** so clients can refresh the summary without waiting for the next poll.
- **REST API**: Authenticated plugin routes for **batch mark** and **batch fetch** with sensible limits (see [HTTP API](#http-api)).
- **Conflict-safe storage**: Receipt merges use optimistic concurrency with retries on the plugin KV store.

---

## Who can record a read receipt?

A user **U** may record a receipt for post **P** when **all** of the following hold:

1. **U** is logged in and passes plugin HTTP auth (`Mattermost-User-ID`).
2. **P** exists and is **not deleted**.
3. **U** is **not** the author of **P** (authors never record receipts on their own posts).
4. **U** is a **member of the channel** containing **P**.
5. **U** is in the **mention audience** of **P**, defined as **any** of:
   - The message contains **`@channel`**, **`@all`**, or **`@here`** (case-insensitive, word boundary).
   - **U**’s user ID appears in `post.props["mentions"]` (supports JSON array, Go string slice, mixed-type slices, or a JSON string encoding an ID array—matching common Mattermost post shapes).
   - **U**’s username matches an **`@username`** token in the message where `username` is resolved via `GetUserByUsername` (broadcast keywords are skipped).

If none of these apply, the server **rejects** storing a receipt for **U** (logged at debug level).

---

## What authors see

- Under **your own** posts, if there is at least one stored reader (excluding yourself), the webapp shows **`Read: …`** with usernames.
- **Recipients** who open the channel still render a minimal anchor component so visibility detection can run where needed; they do **not** see the receipt list for posts they did not author.

---

## Privacy and access control

- **GET read receipts** returns data **only for posts whose `user_id` matches the requesting user** and where that user is still a channel member. You cannot use the API to read receipts on someone else’s posts.
- Receipt payloads include **reader user IDs** and **millisecond timestamps** (`read_at`) as stored server-side.

---

## Technical behavior and limitations

- **Plugin KV namespace**: Receipt documents live under keys prefixed with `readrec_v1_` plus the post ID. KV is **scoped per plugin ID**; changing `plugin.json` → `id` creates a **new** plugin identity on the server, so **existing receipts are not migrated automatically**.
- **Mark vs. display rules**: **Recording** a receipt enforces the mention audience using the **current post** fetched at mark time. **Listing** receipts for your posts does **not** re-filter historical readers if the message is later edited and mentions change—already stored readers remain visible (by design for simplicity).
- **Batch limits**: Up to **80** post IDs per mark or get request (constant `maxReadReceiptPostIDs` on the server).
- **Webhooks / bots**: Behavior follows the same mention rules on the **stored post** at mark time; special cases are not implemented beyond normal post metadata.
- **Boilerplate**: This codebase still includes the starter **slash command** (`/hello`) and sample **`/api/v1/hello`** handler; remove them in a production fork if unwanted.

---

## Requirements

The versions below are what this repository declares and is developed against. Pinning them avoids “works on my machine” drift between contributors and CI.

### Mattermost Server

| | Version |
|---|--------|
| **Minimum** (manifest) | **6.2.1** — set in [`plugin.json`](plugin.json) as `min_server_version`. The server will refuse or warn on older Mattermost builds depending on policy. |
| **Recommended / tested** | **Mattermost 11.6.x** — primary manual testing target. The webapp depends on **`@mattermost/types`** and **`mattermost-redux` `11.1.0`** ([`webapp/package.json`](webapp/package.json)); use a **Mattermost 11.x** server for the closest match to those APIs and Redux shapes. |

Server-side plugin API comes from **`github.com/mattermost/mattermost/server/public`** ([`go.mod`](go.mod)), currently **`v0.1.21`**. Newer Mattermost releases often ship with compatible server bundles; if you upgrade the server, bump this module to the version documented for that Mattermost release if builds fail.

### Toolchain (build from source)

| Tool | Version | Where it is defined |
|------|---------|---------------------|
| **Go** | **1.25.0** | [`go.mod`](go.mod) (`go 1.25.0`) |
| **Node.js** | **20.20.2** | [`.nvmrc`](.nvmrc) |

Use [nvm](https://github.com/nvm-sh/nvm) from the repo root:

```bash
nvm install
nvm use
```

Then install webapp dependencies (see [Development](#development)).

**npm**: Use a current npm release bundled with Node 24 (e.g. run `npm -v` after `nvm use`; lockfile is [`webapp/package-lock.json`](webapp/package-lock.json)).

---

## Installation

1. Build the plugin bundle (see [Building and versioning](#building-and-versioning)).
2. Upload **`dist/<plugin-id>-<version>.tar.gz`** via **System Console → Plugins → Upload Plugin**, or use **`mmctl plugin install`** / **`make deploy`** for development servers.
3. Enable the plugin in **System Console → Plugins**.

Ensure **Plugin uploads** or your deployment path allows installing the bundle (see [Development](#development)).

---

## Architecture overview

### Server

- **`server/read_receipts.go`**: KV **get/merge** with retries, **`recordReadReceipt`**, HTTP handlers **`handleMarkReadReceipts`** / **`handleGetReadReceipts`**, **`PublishWebSocketEvent`** after a successful merge.
- **`server/read_receipt_mentions.go`**: **`readerMayAckReadReceipt`** (mention audience checks shared with mark path).
- **`server/api.go`**: Routes under **`/api/v1`** (plugin-relative base URL).

### Web application

- Registers a **`PostMessageAttachment`** component so receipts render with posts. Mattermost supplies **`postId`** for this pluggable; the component resolves **`post`** from Redux via **`getPost`** when needed.
- **`IntersectionObserver`** triggers batched **mark** requests when the viewer is eligible (client mirrors mention rules to reduce useless API calls).
- Subscribes to **`custom_<pluginId>_read_receipt_updated`** and updates a small in-memory store for instant UI refresh.

---

## HTTP API

Base path (authenticated Mattermost session / CSRF as used by the webapp):

```http
https://<site-url>/plugins/mention-read-receipts/api/v1/
```

Replace **`mention-read-receipts`** if you change `plugin.json` → **`id`**.

### `POST /read-receipts/mark`

Records read receipts for the authenticated user.

**Request body (JSON):**

```json
{
  "post_ids": ["post_id_1", "post_id_2"]
}
```

**Responses:**

- **`200 OK`** — `{ "status": "ok" }`. Per-post failures are skipped with debug logging (invalid post, not channel member, author self-read, not in mention audience, etc.).
- **`400 Bad Request`** — malformed JSON or too many IDs (> 80).

### `GET /read-receipts`

Returns receipts **only for posts authored by the caller**.

**Query:**

| Parameter | Description |
|-----------|-------------|
| `post_ids` | Comma-separated post IDs (max 80 after deduplication). Empty → empty `receipts`. |

**Response (`200 OK`):**

```json
{
  "receipts": {
    "post_id_1": {
      "reader_user_id": 1712345678901
    }
  }
}
```

Values are **`read_at`** in **Unix milliseconds**.

---

## WebSocket events

After a successful receipt merge, the server publishes:

| Field | Value |
|-------|--------|
| Event name | `custom_<plugin_id>_read_receipt_updated` |
| Broadcast | Same **channel** as the post |
| Payload | `post_id`, `reader_id`, `read_at` (stringified timestamp in plugin code) |

The webapp registers this event in [`webapp/src/index.tsx`](webapp/src/index.tsx) and updates [`read_receipt_store`](webapp/src/read_receipt/read_receipt_store.ts).

---

## Development

### Prerequisites

- Go toolchain matching [`go.mod`](go.mod).
- Node matching [`.nvmrc`](.nvmrc) and npm (install webapp deps from [`webapp/package.json`](webapp/package.json)).

### Sync generated manifest files

After editing [`plugin.json`](plugin.json), regenerate embedded manifests:

```bash
make apply
```

This updates **`server/manifest.go`** and **`webapp/src/manifest.ts`** (often gitignored; safe to regenerate before releases).

### Enable plugin uploads (local / dev)

```json
"PluginSettings": {
    "EnableUploads": true
}
```

Restart Mattermost after changing config.

### Deploy with local mode (`make deploy`)

See [Mattermost mmctl local mode](https://docs.mattermost.com/administration/mmctl-cli-tool.html#local-mode). Example server snippet:

```json
{
    "ServiceSettings": {
        "EnableLocalMode": true,
        "LocalModeSocketLocation": "/var/tmp/mattermost_local.socket"
    }
}
```

Then:

```bash
make deploy
```

Optional socket override:

```bash
export MM_LOCALSOCKETPATH=/var/tmp/alternate_local.socket
make deploy
```

### Watch mode (webapp + redeploy)

```bash
export MM_SERVICESETTINGS_SITEURL=http://localhost:8065
export MM_ADMIN_TOKEN=<your-admin-token>
make watch
```

### Deploy with username/password or token

```bash
export MM_SERVICESETTINGS_SITEURL=http://localhost:8065
export MM_ADMIN_USERNAME=admin
export MM_ADMIN_PASSWORD=password
make deploy
```

Or use a [personal access token](https://docs.mattermost.com/developer/personal-access-tokens.html):

```bash
export MM_SERVICESETTINGS_SITEURL=http://localhost:8065
export MM_ADMIN_TOKEN=<token>
make deploy
```

### Debug webapp bundle

```bash
make dist MM_DEBUG=1
```

---

## Building and versioning

From the repository root:

```bash
make dist
```

Produces **`dist/<bundle-name>.tar.gz`** for upload.

Version handling (unless you pin **`version`** manually in `plugin.json`):

- If `HEAD` matches a Git tag: version is the tag without a leading `v` (e.g. `1.3.1`).
- Otherwise: nearest tag plus short SHA (e.g. `1.3.1+d06e53e1`).
- With no tags: `0.0.0+<short-sha>`.

See `make apply` / `build/manifest` tooling for details.

---

## Releasing

Semantic release helpers (tags + changelog flow depending on template Makefile):

| Goal | Command |
|------|---------|
| Patch | `make patch` |
| Minor | `make minor` |
| Major | `make major` |
| Patch RC | `make patch-rc` |
| Minor RC | `make minor-rc` |
| Major RC | `make major-rc` |

---

## Forking this repository

If you publish your own fork:

1. Set **`id`**, **`name`**, **`description`**, **`homepage_url`**, **`support_url`**, and **`icon_path`** in [`plugin.json`](plugin.json).
2. Run **`make apply`** so manifests stay in sync.
3. Update **Go module path** in [`go.mod`](go.mod) and replace imports of `github.com/mattermost/mattermost-plugin-starter-template` across **`server/**/*.go`** (and regenerate mocks / [`Makefile`](Makefile) `mockgen` paths if needed).
4. Adjust **`.golangci.yml`** `local-prefixes` to your module path.
5. Update **README badges** and repository URLs so CI badges point at **your** GitHub org/repo.

---

## License

See [`LICENSE`](LICENSE). Portions may retain Mattermost starter-template copyright notices in individual files.

---

## Further reading

- [Mattermost plugin developer documentation](https://developers.mattermost.com/extend/plugins/)
