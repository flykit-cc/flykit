# steuer: correctness core (tier 1) + hosted validation API (tier 2)

Date: 2026-07-31 · Status: approved · Scope: one build session

All examples in this document use invented data. No real transactions,
merchants, amounts, or identifiers appear anywhere in it.

## Why

The shipped `steuer` plugin (0.1.0) computes totals by summing a column and
classifies income with keyword rules. Both approaches are documented failures:
bank statements contain pre-authorisation holds, reversals, funding legs, and
non-balance-affecting rows, so summing debits overstates spend badly, and
keyword rules mis-bucket silently. The redesign below replaces both with the
pipeline that survived a real multi-thousand-row filing run.

Product context (decided, recorded here for orientation):

- **Tier 1 — numbers** (this doc, plugin-only): parse → net → classify via
  verdict map → reconcile → EÜR figures + "type this into Mein ELSTER".
- **Tier 2 — validation** (this doc, one Lambda): XML in → official ELSTER
  SDK (ERiC) validate → result + official PDF out. Hosted because the ERiC
  license forbids redistributing the SDK; users never install it.
- **Tier 3 — local send** (not this session): transmission happens only on
  the user's machine with the user's own certificate. Never server-side.

## Tier 1 — correctness core (`steuer` 0.2.0)

### Pipeline

```
sources (wise | csv-import)
  → filter: drop rows that moved no money (auths, holds, memo rows)
  → group: key = merchant, falling back to payee, then payer
  → net: each group nets against its own offsetting credits;
         groups whose gross and net diverge past a threshold are flagged
  → overlap: detect the same spend appearing in two sources before merging;
             report which source won
  → verdicts: look up each group in verdicts-<year>.json
  → reconcile: every row lands in exactly one bucket; row counts must sum
               to the total; the assertion is printed, not implied
```

### The verdict map

`verdicts-<year>.json` in the user's working directory. One entry per
merchant group, written once — by the model actually reading the group, or by
the user answering a question — and applied by code forever after.

```json
{
  "example hosting gmbh": { "code": "B", "category": "Hosting", "share": 1.0 },
  "example gym":          { "code": "P" },
  "example coworking":    { "code": "A", "category": "Arbeitsplatz", "share": 0.5 }
}
```

Rules, each of which prevented a real bug:

- **Longest key match wins**; later entries override earlier ones.
- **Absent from the map → `MISSING`**, reported loudly, never defaulted.
- **Unknown code → throw.** Dispatch is exhaustive; there is no silent else.
- Codes: `B` business, `A` apportioned (share required), `P` private,
  `V` Vorsorge (ESt, not EÜR), `N` not an expense (transfer/capital),
  `R` needs the user, `M` medical (§33), `H` household (§35a).
- Issuer/platform names (card issuers, PSPs) must not carry a category
  themselves — they swallow unrelated merchants.

### Skill flow (`parse-statements`)

1. Script ingests, filters, nets, detects overlap, prints per-file row counts
   and the group list with `MISSING` entries.
2. Claude reads every `MISSING` group (largest first) and writes verdicts.
3. Whatever Claude cannot decide goes to the user via `AskUserQuestion`,
   **one question at a time**, amounts and tax consequence in every option,
   payment references shown when the source has them.
4. Each answer is written into the verdict map immediately.
5. Re-run reconcile; the row-count assertion must tie before `calculate-euer`
   is offered.

### Other tier 1 changes

- **FX**: fetch daily ECB reference rates from the ECB data API directly
  (cached per year next to the data; weekend/holiday fallback up to 7 days).
- **CSV robustness**: strip BOM on headers; read the currency column on every
  row — never assume a single-currency statement.
- Income keyword rules survive only as suggestions feeding step 2; the
  verdict map is the single source of truth.
- Version bump to 0.2.0 in all three manifests (plugin.json, package.json,
  marketplace.json).

### Testing

Every module gets a test with invented fixtures, including known-answer cases
for the documented bug classes: pre-auth holds netting to the real fare, the
same purchase visible in two sources, memo rows that moved no money, a BOM'd
header, a mixed-currency file, an unknown verdict code (must throw), and a
merchant absent from the map (must surface as MISSING, not default).

## Tier 2 — hosted validation API (`steuerpilot-api`)

### Shape

- Python 3.12 **Lambda, plain zip** (no container: the trimmed SDK — core
  libs plus only the form modules we validate — measures well under the
  250 MB layer limit; the full SDK is ~2 GB of forms this API never touches).
- Region `eu-central-1`. Function URL, fronted by a Cloudflare Worker at a
  `flykit.cc` subdomain (Lambda function URLs cannot carry custom domains
  directly; the Worker is a host-header-rewriting proxy).
- Auth: static API key checked in the handler (env var). Quotas later.

### Endpoints

| | |
|---|---|
| `POST /validate` | body: `{ xml, datenart, pdf?: bool }` → `{ ok, code, messages[], pdf_base64? }` |
| `GET /health` | SDK loaded, version string |

### Safety invariants

- **Validate-only.** The deployed code contains no send path, no certificate
  handling, no PIN handling. Transmission is impossible server-side by
  construction, not by configuration.
- **No persistence.** Request XML is processed in memory; ERiC log output
  goes to ephemeral `/tmp` and is not shipped anywhere (license §15 makes
  server-side logs the operator's data-protection problem — so there are none).
- The vendor ID (HerstellerID) — if needed at all for validation — lives in a
  server env var only, never in committed code.

### Build & deploy

`build.sh`: take the ERiC Linux x86_64 package (downloaded manually from the
ELSTER developer area — the license forbids us redistributing or committing
it), extract core libs + required form modules, zip with the handler, deploy
via `aws` CLI (S3 staging for the >50 MB artifact). Smoke test with the SDK's
own sample datasets — never real user data.

The repo stays local this session; publishing is a separate decision.

### Deferred (tracked in the session task list)

Profile-driven XML generators for arbitrary users; first-run DSGVO
acknowledgment gate (contractual before public ERiC-based use); AfA/GWG
depth; `ask-open-questions` as a standalone skill; API quotas/keys per user;
OTTO retrieval.

## Error handling, both tiers

- Fail closed: a source file that can't be parsed stops the run with the
  filename and reason; it never silently drops out.
- Anything unrecognised is surfaced (`UNKNOWN` bucket, `MISSING` verdict,
  non-zero exit) rather than defaulted.
- ERiC error codes are translated to their official text; validation detail
  lines are surfaced verbatim to the caller.
