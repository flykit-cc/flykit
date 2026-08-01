# steuerpilot-api — Hosted Validation Lambda Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development
> Repo is LOCAL-ONLY this session (`~/Documents/GitHub/steuerpilot-api`); nothing is pushed.

**Goal:** One Lambda (zip, `eu-central-1`) that validates ELSTER XML through ERiC and returns the result + official PDF; fronted by a Cloudflare Worker at `steuer.flykit.cc/api`.

**Architecture:** Python 3.12 handler + minimal ctypes wrapper (validate-only) + the SDK's own python binding bundled by the build script. No container, no server-side send path, no persistence.

**Tech Stack:** Python 3.12 Lambda (x86_64), aws CLI, Cloudflare Worker (wrangler), ERiC 44 Linux x86_64.

## Global Constraints

- **Validate-only by construction**: no certificate, PIN, or send code anywhere in the repo.
- No persistent logs: ERiC log dir = `/tmp`, nothing shipped; handler prints only request metadata (datenart, rc, ms), never XML content.
- ERiC SDK files are never committed (`.gitignore`: `ERiC*/`, `build/`, `*.zip`, `.env`) and never pushed anywhere public; uploading to the owner's own AWS account is use, not redistribution.
- API key required on every request except nothing — `/health` requires it too (no anonymous surface); compare with `hmac.compare_digest`.
- HerstellerID, API key, function URL live in env/`.env` only.
- Region `eu-central-1`; the user's default AWS region must not be changed.

---

### Task 1: repo skeleton + eric_min.py (loadable without SDK)

**Files:**
- Create: `~/Documents/GitHub/steuerpilot-api/{.gitignore,README.md,src/eric_min.py,src/handler.py,tests/test_handler.py}`

**Interfaces:**
- `eric_min.Eric(sdk_lib_dir, plugin_dir, log_dir='/tmp/eric-log')` — wraps `EricInitialisiere`/`EricBeende` via the SDK's `ericapi` binding (bundled at build time under `vendor/`); import of the binding happens lazily inside `Eric.__init__` so unit tests run without the SDK.
- `Eric.validate(xml: str, datenart: str, want_pdf: bool) -> dict` — flags `VALIDIERE|PRUEFE_HINWEISE` (+`DRUCKE` to a `/tmp` pdf when asked); returns `{ ok, code, messages: [...], pdf_base64|None }`; rc 0 and 610001003 are both ok (hints); on ERiC init/process failure raise `EricError(code, text)` with the official `EricHoleFehlerText` text.
- `handler.lambda_handler(event, context)` — Function-URL event shape; routes: `GET /health` → `{ ok, eric: <version-or-'not-loaded'> }`, `POST /validate` body `{ xml, datenart, pdf? }`; 401 on bad/missing `x-api-key`; 400 on missing fields with a one-line reason; 422 with `messages` when validation fails; 200 `{ ok: true, code, messages, pdf_base64? }` otherwise.
- [ ] Failing tests (no SDK on this Mac — SDK interactions faked with a stub `Eric` injected via `handler.ERIC_FACTORY`): 401 without key and with wrong key; 400 on missing xml/datenart; 422 path maps a failing stub result; 200 happy path with pdf_base64 passthrough; `/health` with key → ok.
- [ ] Implement; `python3 -m pytest` green; commit `feat: validate-only handler with stubbed ERiC`

### Task 2: build.sh — trim SDK, zip, size guard

**Files:**
- Create: `build.sh`

**Behaviour (all paths relative to repo root):**
1. Locate `ERiC-44*Linux-x86_64*` archive in `~/Downloads` (accept `.jar`/`.zip`); `unzip -q` into `build/sdk/`.
2. Copy into `build/pkg/`: `src/*.py`; SDK python binding → `vendor/`; `lib/` = top-level `libericapi.so`, `libericxerces.so`, plus every lib the api lib links (`ldd` is unavailable on macOS — copy all top-level `*.so` except `libotto*`), and `lib/plugins2/` (or `plugins/`, whichever the package has) filtered to `*ESt_2025*`, `*EUER_2025*`, `*USt_2025*` and their `common`/`Basis` siblings if present.
3. `zip -qr build/steuerpilot-api.zip .` from `build/pkg/`.
4. Size guard: unzipped bytes < 240 MB or exit 1 telling which dirs to trim.
- [ ] Dry-run test with a FAKE SDK tree (`tests/fixtures/fake-sdk/` containing tiny dummy `.so` files, committed) via `SDK_ARCHIVE=... ./build.sh` → zip exists, contains `lib/`, `vendor/`, `handler.py`, guard passes; real run happens in Task 4.
- [ ] Commit `feat: build script trims SDK to validate-only payload`

### Task 3: deploy.sh + smoke.sh

**Files:**
- Create: `deploy.sh`, `smoke.sh`

**deploy.sh** (idempotent, `set -euo pipefail`, everything `--region eu-central-1`):
1. Role `steuerpilot-api-exec` with `AWSLambdaBasicExecutionRole` (create if missing).
2. Staging bucket `steuerpilot-api-deploy-<account>` (create if missing), `aws s3 cp` the zip.
3. `aws lambda create-function` (or `update-function-code`): runtime python3.12, arch x86_64, memory 2048, timeout 60, handler `handler.lambda_handler`, env `API_KEY` (generate `openssl rand -hex 24` into local `.env` on first run), `ERIC_LIB_DIR=/var/task/lib`, `LD_LIBRARY_PATH=/var/task/lib`.
4. Function URL auth-type NONE (our own key check inside) + print it; write to `.env` as `FUNCTION_URL=`.
**smoke.sh:** `curl` `/health` with key from `.env` → expect `"ok": true`; then `POST /validate` with an SDK sample dataset (`build/sdk/**/Beispiel*/**.xml`, first match; Testmerker sample — public SDK test data, not user data) → expect HTTP 200 or a 422 whose `messages` are non-empty (both prove ERiC executed); print rc + first message.
- [ ] Shellcheck-clean; commit `feat: deploy + smoke scripts`

### Task 4 (BLOCKED until Linux ERiC 44 is in ~/Downloads): real build, deploy, smoke

- [ ] `./build.sh` with the real archive; note the real zip size.
- [ ] `./deploy.sh`; `./smoke.sh` → paste rc/messages into the session log.
- [ ] If the binding needs `libeSigner.so` at init even for validate (error 610201140-class), re-add it from the eSigner patch jar and re-run.

### Task 5: Cloudflare Worker — steuer.flykit.cc/api

**Files:**
- Create: `worker/wrangler.toml`, `worker/src/index.js`

**Behaviour:** Worker bound to route `steuer.flykit.cc/api/*` (zone `flykit.cc`): strip the `/api` prefix, forward method/body/headers to `FUNCTION_URL` origin (Host header becomes the Lambda's own — that is the whole reason a plain CNAME cannot work), stream the response back. `FUNCTION_URL` is a Worker secret (`wrangler secret put`), not committed. The client's `x-api-key` passes through untouched — the Worker adds no auth of its own.
- [ ] `wrangler whoami` first; if unauthenticated, stop and hand the login to the user (interactive).
- [ ] `wrangler deploy` + DNS: the route's custom domain is created by wrangler (`routes = [{ pattern = "steuer.flykit.cc/api/*", zone_name = "flykit.cc" }]` requires an existing DNS record — create a proxied placeholder AAAA `100::` for `steuer` via API if absent).
- [ ] `curl https://steuer.flykit.cc/api/health -H "x-api-key: …"` → same body as the function URL. Commit `feat: cloudflare worker proxy`.

## Self-review

- No file in the repo contains: certificate paths, PINs, HerstellerID, account IDs, real XML.
- `git status` at the end shows no SDK file tracked.
- The only artifacts with secrets are `.env` (gitignored) and Worker secrets.
