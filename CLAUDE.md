# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A local emulator of the T-Bank (Tinkoff) Acquiring API (`securepay.tinkoff.ru/v2`) — lets other
projects integrate against `Init`/`GetState`/`Cancel` and receive webhooks without touching the
real gateway. It is intentionally a small, single-purpose Express app, not a general payments
platform — resist growing it into one (see Deliberate limitations below).

## Commands

```bash
npm install
TERMINAL_KEY=MyTerminal PASSWORD=MyPassword npm start   # runs src/app.js on :3000

docker build -t tbank-gateway .
docker run -p 3000:3000 -e TERMINAL_KEY=MyTerminal -e PASSWORD=MyPassword -e BASE_URL=http://localhost:3000 tbank-gateway
```

`npm install` also regenerates `llms.txt`/`llms-full.txt` from `openapi.yaml` via `postinstall`
(run `npm run build:docs` to do just that, without a full install).

There is no test suite and no linter configured in this repo. Verification is manual: start the
server and drive it with `curl` (Init → GetState → payment page `complete` action → Cancel),
or use the Scalar UI at `/docs`. `TERMINAL_KEY`/`PASSWORD` must match what the request `Token` was
signed with, or every call fails with `ErrorCode 7`/`9`.

Dockerfile pins `node:22-alpine` — required by `@scalar/express-api-reference`'s transitive deps
(`@scalar/schemas`, `@scalar/types` need Node ≥22). Don't downgrade it without checking that still holds.

Dockerfile does `COPY . .` **before** `RUN npm ci --production` (not the usual cache-friendly
package.json-first order) — `postinstall` needs `openapi.yaml` and `scripts/` already present to
generate the llms.txt docs during the build. Don't reorder this back without adjusting that.

## Architecture

Everything lives in three files under `src/`, no framework/router abstraction:

- **`app.js`** — the entire Express app: all routes, the webhook sender, and the Scalar/OpenAPI
  mount. New endpoints go here as more `app.get`/`app.post` handlers, following the existing
  pattern (validate `TerminalKey` → `verifyToken` → look up payment → mutate → respond → fire
  webhook async).
- **`token.js`** — the SHA-256 request-signing algorithm, an exact port of T-Bank's: take
  root-level scalar fields only (drop `Token`, drop nested objects/arrays like `Receipt`), append
  `Password`, sort keys, concatenate values with no separator, SHA-256. Used both to verify
  incoming requests and to sign outgoing webhook payloads. Any new top-level request field is
  automatically included in signing — no changes needed there when adding fields.
- **`storage.js`** — in-memory `Map` of payments (numeric `PaymentId` starting at `2460000000`,
  string-keyed) plus a global webhook log. No persistence; state is lost on restart by design.

### Payment status state machine

`NEW` → (`/payment/:id/complete` action) → `CONFIRMED` or `REJECTED` → (`/v2/Cancel`) →
`PARTIAL_REFUNDED` (repeatable — each call reduces `refundedAmount` further) → `REFUNDED` once
the full amount is refunded. `Cancel` on `NEW`/`REJECTED`/already-`REFUNDED` payments is rejected.

### Error code convention (not centralized — same pattern repeated per handler)

`0` success · `6` payment not found · `7` invalid `TerminalKey` · `9` invalid `Token` ·
`15` invalid state transition for `Cancel` (wrong status, or `Amount` exceeds remaining) ·
`51` simulated insufficient-funds decline (only via the payment page's third button).

### Webhook dispatch

`sendWebhook()` in `app.js` fires-and-forgets a signed POST to the payment's `NotificationURL` on
every status change (approve/reject/insufficient-funds/cancel). For `CONFIRMED` specifically, it
randomly (`WEBHOOK_DELAY_PERCENT`) sleeps `WEBHOOK_DELAY_SECONDS` before sending — this simulates
real-world slow/delayed bank webhooks and is load-bearing for testing race conditions in
integrating projects; don't "fix" it away as dead code.

### OpenAPI / Scalar docs

`openapi.yaml` at the repo root is the source-of-truth spec for every route (including the
outgoing webhook, modeled as a `callback` on `Init`). It's served raw at `/openapi.yaml` and
rendered interactively at `/docs` via `@scalar/express-api-reference` (mounted in `app.js`).
**When you change a route's request/response shape in `app.js`, update `openapi.yaml` to match** —
nothing generates one from the other. Other projects are expected to read this spec to understand
how to integrate, so it must reflect actual behavior, not the aspirational real-API behavior
(e.g. `PayType`/`Receipt` are accepted but explicitly documented as ignored).

`openapi.yaml` is parsed with `js-yaml` at build time (see below) — that parser errors on any
plain (unquoted) scalar whose value starts with a backtick, e.g. `description: \`x\` and \`y\``
(fails), vs `description: "\`x\` and \`y\`"` (fine). Quote any description that starts with a
backtick.

### llms.txt for external agents

`scripts/generate-llms-docs.js` reads `openapi.yaml` and writes `llms.txt` (short index) and
`llms-full.txt` (full Markdown per operation, via `@scalar/openapi-to-markdown`) at the repo root,
following the [llms.txt](https://llmstxt.org/) convention — so agents from other projects can read
plain Markdown instead of rendering the Scalar UI. Served at `/llms.txt`/`/llms-full.txt` in
`app.js` via plain `res.sendFile`, same pattern as `/openapi.yaml`.

These two files are **generated, not committed** (gitignored) — regenerated by the `postinstall`
npm hook on every `npm install`/`npm ci`, including inside the Docker build. `npm run build:docs`
runs the same script manually. If you edit `openapi.yaml`, run `npm install` (or `build:docs`)
locally to refresh them before relying on `/llms.txt` output.

### Deliberate limitations (don't silently "fix" these — they're scoped out on purpose)

- No 3DS emulation — payments resolve straight to `CONFIRMED`/`REJECTED`.
- No two-stage confirm flow — `PayType: "T"` is accepted but has no effect; there is no `/v2/Confirm`.
- No TTL/expiration on payments.
- In-memory only — a restart wipes all payment/webhook history.

If real T-Bank API behavior needs verifying, note that `developer.tbank.ru/eacq/api/*` renders
response schemas client-side via JS — plain `curl`/WebFetch only gets the request-schema half of
each page.
