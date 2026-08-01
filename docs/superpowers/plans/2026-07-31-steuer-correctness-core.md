# steuer 0.2.0 — Correctness Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development
> Implement task-by-task; steps use checkbox syntax for tracking.

**Goal:** Replace column-summing and keyword classification in `plugins/steuer` with the netting → verdict-map → reconciliation pipeline.

**Architecture:** New pure modules (`netting.js`, `verdicts.js`, `overlap.js`, `reconcile.js`) feed a reworked `parse-statements.js`; `calculate-euer.js` consumes verdict-coded transactions. All CommonJS, `node --test`, no new dependencies.

**Tech Stack:** Node >= 18, node:test + assert/strict, existing plugin layout.

## Global Constraints

- CommonJS (`require`/`module.exports`) everywhere; match existing 4-space indent and comment style.
- Zero personal data: fixtures use invented merchants/amounts only.
- No new npm dependencies.
- Fail closed: unparseable input stops the run naming the file; nothing silently drops out.
- Unknown verdict code → throw. Missing verdict → `MISSING`, never a default.
- Every changed file keeps its existing public exports working unless a task says otherwise.
- Version bump to 0.2.0 in plugin.json + package.json + marketplace.json happens ONLY in the final task, same commit as nothing else.
- Run tests from `plugins/steuer/` with `npm test`.

---

### Task 1: netting.js — grouping + per-group netting

**Files:**
- Create: `plugins/steuer/scripts/netting.js`
- Test: `plugins/steuer/scripts/netting.test.js`

**Interfaces:**
- Produces:
  - `groupKey(txn) -> string` — lowercase trim of `txn.merchant || txn.payee || txn.payer || txn.description`; throws `new Error('transaction has no grouping key: ' + JSON.stringify(txn))` if all empty.
  - `filterMoved(txns) -> { kept, dropped }` — drops rows with `amount === 0` or `txn.raw?.balanceImpact === 'Memo'` or `['CANCELLED','DECLINED','REFUNDED_PREAUTH'].includes(txn.raw?.status)`.
  - `netGroups(txns, { flagThreshold = 0.2 } = {}) -> Group[]` where txns carry **signed** `amount` (expense negative, income positive) and `Group = { key, txns, gross, net, credits, flagged }`; `gross` = sum of negatives (abs), `credits` = sum of positives inside a net-negative group, `net` = |sum|, `flagged` = credits > 0 && (gross - net) / gross > flagThreshold. Sign of the group: `direction: 'in' | 'out'` from the sum's sign.

- [ ] **Step 1: failing tests** — invented fixtures covering: (a) the pre-auth case: `ride-hail-x` debits −20.00 −20.00 −20.00, credits +18.50 +17.00 → net 24.50 out, flagged; (b) partial reversal below threshold not flagged; (c) mixed group summing positive → direction 'in'; (d) zero-amount row dropped by `filterMoved`; (e) `raw.balanceImpact==='Memo'` dropped; (f) no grouping key throws.
- [ ] **Step 2: run, verify all fail** (`npm test`)
- [ ] **Step 3: implement minimal netting.js**
- [ ] **Step 4: run, verify pass**
- [ ] **Step 5: commit** `feat(steuer): per-group netting with reversal flagging`

### Task 2: verdicts.js — verdict map load/lookup/apply

**Files:**
- Create: `plugins/steuer/scripts/verdicts.js`
- Test: `plugins/steuer/scripts/verdicts.test.js`

**Interfaces:**
- Consumes: `Group` from Task 1.
- Produces:
  - `CODES` — `{ B, A, P, V, N, R, M, H, I, NI }` (expense codes per design doc; `I` taxable income group, `NI` inbound-not-income). Frozen object mapping code → human label.
  - `loadVerdicts(filePath) -> object` — `{}` if file absent; parse error throws naming the file.
  - `saveVerdicts(filePath, map)` — pretty-printed, stable key order (insertion).
  - `lookupVerdict(map, key) -> verdict | null` — case-insensitive substring match of map keys against the group key; **longest key wins; on equal length the later entry wins**.
  - `applyVerdicts(groups, map) -> { classified: [{ group, verdict, mapKey }], missing: Group[] }`
  - `validateVerdict(v)` — throws on unknown `code`, on `A` without numeric `share` in (0,1], on non-object.
- [ ] Failing tests: longest-match beats shorter; later same-length overrides; unmapped group → in `missing` (and NOT in classified); unknown code `'X'` throws; `A` without share throws; empty file path → `{}`; roundtrip save/load preserves order.
- [ ] Implement, pass, commit `feat(steuer): verdict map with longest-match lookup and MISSING reporting`

### Task 3: reconcile.js — full-coverage assertion

**Files:**
- Create: `plugins/steuer/scripts/reconcile.js`
- Test: `plugins/steuer/scripts/reconcile.test.js`

**Interfaces:**
- Consumes: Task 1 groups, Task 2 `applyVerdicts` output.
- Produces:
  - `BUCKETS = ['INCOME','NOT_INCOME','EXPENSE','INTERNAL','UNKNOWN']`
  - `bucketFor(code) -> bucket` — `I→INCOME`, `NI→NOT_INCOME`, `N→INTERNAL`, `B/A/P/V/R/M/H→EXPENSE`; anything else throws (exhaustive dispatch, no silent else).
  - `reconcile({ totalRows, droppedRows, classified, missing }) -> { buckets: {bucket: {rows, sumEUR?}}, ok, line }` — `ok` when bucket row counts + dropped == totalRows; `line` is the printable assertion, e.g. `row-count check: 1816 == 1816 -> OK — every row accounted for` or `-> MISMATCH (short by 3)`.
- [ ] Failing tests: counts tie → ok true + line contains 'OK'; missing groups land in UNKNOWN; a fabricated mismatch → ok false and line names the delta; `bucketFor('Z')` throws.
- [ ] Implement, pass, commit `feat(steuer): reconciler with row-count assertion`

### Task 4: overlap.js — cross-source duplicate detection

**Files:**
- Create: `plugins/steuer/scripts/overlap.js`
- Test: `plugins/steuer/scripts/overlap.test.js`

**Interfaces:**
- Produces: `detectOverlap(txns, { windowDays = 3 } = {}) -> { pairs, excluded }` — candidate pairs are rows from **different** `source` values with equal `currency`, |amount| equal to the cent, dates within window. When one side's description contains the other's source marker (`paypal` in a card row description) the funding leg is `excluded`; otherwise pair is reported for the skill layer to surface. Never auto-drops both sides.
- [ ] Failing tests: card row `PAYPAL *EXAMPLESHOP` −49.99 vs csv-import PayPal row `Exampleshop` −49.99 next day → funding leg excluded, itemised kept; same-source duplicates NOT paired; amounts differing by 0.01 NOT paired; window boundary respected.
- [ ] Implement, pass, commit `feat(steuer): cross-source overlap detection`

### Task 5: rateConverter — ECB direct + on-disk cache

**Files:**
- Modify: `plugins/steuer/scripts/rateConverter.js`
- Test: extend `plugins/steuer/scripts/rateConverter.test.js`

**Interfaces:**
- Keep `prefetchRates(year, from, to)`, `getRate`, `batchConvert` signatures.
- Change the fetch URL to `https://data-api.ecb.europa.eu/service/data/EXR/D.{from}.{to}.SP00.A?startPeriod={year}-01-01&endPeriod={year}-12-31&format=csvdata` with a `User-Agent` header; parse CSV columns `TIME_PERIOD`, `OBS_VALUE`. **Note the rate direction: the series quotes {from} per 1 {to} (USD per EUR), so converting USD→EUR divides: `amountEUR = amount / rate` — the OPPOSITE of Frankfurter's multiply. `batchConvert` must be updated in the same task and the direction covered by a known-answer test (e.g. rate 1.25, $10 → €8.00).**
- Add `cacheDir` option: `prefetchRates(year, from, to, { cacheDir })` writes/reads `ecb-{from}-{to}-{year}.csv` so re-runs are offline.
- [ ] Failing tests: parse a fixture CSV string (no network) into the cache map; direction known-answer: rate 1.25 converts $10 → €8.00 (not €12.50); cache file round-trip; weekend fallback still works (existing test keeps passing).
- [ ] Implement (network path manual-verified once; tests stay offline), pass, commit `feat(steuer): fetch ECB reference rates directly with a year cache`

### Task 6: parse-statements.js — new pipeline + groups artifact

**Files:**
- Modify: `plugins/steuer/scripts/parse-statements.js`
- Test: extend `plugins/steuer/scripts/parse-statements.test.js`

**Interfaces:**
- Consumes: Tasks 1–4 modules.
- Produces on disk (in `--output` dir):
  - `steuer-<YEAR>-classified.json` — now `{ year, source, income, expenses, groups, reconciliation }`; every txn gains `groupKey`, `verdictCode|null`, `netted: bool`; income keyword classifier results kept as `suggestion` fields only.
  - `verdicts-<YEAR>.json` — created empty `{}` if absent; never overwritten with fewer keys than it had (guard: refuse to save a strictly-smaller map without `--force`).
- Console output ends with the reconcile `line` and a `MISSING (n groups): …` list sorted by |net| desc — this is what the skill layer parses.
- New flags: `--verdicts <path>` (default `<output>/verdicts-<YEAR>.json`), `--prefer-source <name>` for overlap exclusion.
- [ ] Failing tests: run `main`'s pieces against a tmp dir with invented fixture files: classified.json contains groups + reconciliation; verdict shrink-guard throws without `--force`; MISSING list sorted by |net|.
- [ ] Implement, pass, commit `feat(steuer): pipeline = filter -> net -> overlap -> verdicts -> reconcile`

### Task 7: calculate-euer.js — verdict-aware totals

**Files:**
- Modify: `plugins/steuer/scripts/calculate-euer.js`
- Test: extend `plugins/steuer/scripts/calculate-euer.test.js`

**Interfaces:**
- Consumes: new classified.json shape (Task 6), `CODES` (Task 2).
- Behaviour: income = groups coded `I` (plus legacy `classification === 'taxable'` rows when no verdict, so old files still work); expenses = codes `B` fully and `A` × `share`; codes `P/V/N/NI/M/H` excluded from EÜR; **any group still `R` or MISSING aborts with exit 2 listing them** unless `--include-review` (which includes `R` income-side only, as today).
- Summary JSON gains `by_category` (EUR totals per verdict category) and `excluded` (what was left out and why) blocks.
- [ ] Failing tests: fixture classified.json with one of each code → known-answer Gewinn; apportioned share applied exactly once; `R`/MISSING abort with exit 2; legacy 0.1.0 file still computes.
- [ ] Implement, pass, commit `feat(steuer): EÜR totals from verdict codes, abort on unresolved groups`

### Task 8: SKILL.md flow + README + version bump

**Files:**
- Modify: `plugins/steuer/skills/parse-statements/SKILL.md`, `plugins/steuer/skills/calculate-euer/SKILL.md`, `plugins/steuer/README.md`
- Modify: `plugins/steuer/.claude-plugin/plugin.json`, `plugins/steuer/package.json`, `.claude-plugin/marketplace.json` (0.1.0 → 0.2.0)

**Interfaces:** consumes console contract from Task 6 (`MISSING (n groups):` list, reconcile line).

- [ ] parse-statements SKILL.md: after running the script, Claude reads the MISSING list **largest first** and writes verdicts to the verdict file itself (schema + codes documented inline); anything it cannot decide → `AskUserQuestion` **one question at a time**, each option carrying the EUR amount and the tax consequence, payment reference quoted when present; every answer saved to the verdict file immediately; re-run script until reconcile prints OK and MISSING is empty.
- [ ] calculate-euer SKILL.md: refuses to run while MISSING/R remain (mirrors exit 2); explains `--include-review`.
- [ ] README: new pipeline description, verdict file documented as the hand-editable audit trail; disclaimer section extended with a plain "self-application, no tax advice, review before filing" line.
- [ ] Version 0.2.0 in the three manifests; run `./scripts/check-plugin-versions.sh --since main` from repo root → must pass.
- [ ] `npm test` green; commit `feat(steuer): 0.2.0 — verdict-map flow in skills, docs, version bump`

## Self-review checklist (run after Task 8)

- Every SPEC bug class has a test: pre-auth netting (T1), memo rows (T1), cross-source double count (T4), BOM/currency (already in sources? if csv-import lacks BOM strip, add it in T6), unknown code throws (T2), MISSING never defaults (T2/T7).
- No fixture contains a real merchant, person, IBAN, or amount from any real statement.
- `check-plugin-versions.sh --since main` passes; CI (`pr-check.yml`) runs the same.
