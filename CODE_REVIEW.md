# Code Review — `dat ui` control panel + `datConfig` reclassification

**Scope:** the uncommitted working-tree change in `deployment_assist_tool` — the new local web
control panel (`src/server/ui.ts`, `src/server/uiHtml.ts`, `src/server/ui.test.ts`, `dat ui` in
`src/index.ts`) and the readiness reclassification of `.dat.config.yaml`
(`src/inputs.ts`, `src/readiness.ts`, `src/readiness.test.ts`, `docs/APP_READINESS_REQUIREMENTS.md`).

**Method:** 7 independent finder passes (line-by-line, removed-behavior, cross-file, reuse,
simplification, efficiency, altitude) → dedup → verified each survivor against the current code.

> **Resolution (post-review):** P1 #1–#5 **fixed**, plus #8 (stale comment), #9 (shared report
> server), and #10 (per-request waste) cleaned up. Build clean; full suite **277/277**; UI auth suite
> now **11/11** (added malformed-URL + rebinding-on-`/` cases); live smoke confirmed (`/`→200,
> `/%E0%A4%A`→400, report via shared helper→200, spoofed-Host report→403, unauthed API→403).
> **All P1 + P2 findings resolved.**
> Each finding is annotated **[FIXED]** / **[OPEN]** below.

**Verdict:** No data-corruption or gate-correctness regressions. The cross-file trace confirmed the
risky bits are sound — `loadConfig`/`checkReadiness`/`EnvironmentDetector` all honor the per-request
`workspaceRoot`, so the UI's no-`chdir` model scans arbitrary targets correctly; and removing
`datConfig` from `DEFAULT_CRITICAL` doesn't break any other consumer. The real issues are **three
process-crash / info-disclosure bugs in the new server**, one **latent readiness-display bug**, and
**doc/contract staleness** left by the reclassification.

---

## P1 — Correctness (fix before shipping the UI)

### [FIXED] 1. Malformed request URL crashes the server (`src/server/ui.ts:126`)
```ts
const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
```
This runs at the very top of the async handler, **before** any `try/catch` (the only `try` starts
inside the `/api/` branch). A request like `GET /%` or `GET /%E0` makes `decodeURIComponent` throw
`URIError: URI malformed`. The throw becomes an unhandled promise rejection: no response is written
(the request hangs) and, under Node's default unhandled-rejection policy, the `dat ui` process can
terminate. **Any** local client/crawler can trigger it.
**Fix:** wrap the handler body in `try/catch` (respond 400 on bad URL), or decode defensively.

### [FIXED] 2. Report file stream has no error handler → crash on read failure (`src/server/ui.ts:141`)
```ts
fs.createReadStream(full).pipe(res);   // no .on('error', …)
```
Between the `fs.existsSync(full)` check and the stream opening, the file can disappear — e.g.
`publishReport()` retention pruning deletes an old report, or a mid-transfer I/O error occurs. The
`ReadStream` emits `'error'` with no listener, which Node re-throws as an uncaught exception and
crashes the server. (`src/server/serve.ts:58` has the identical gap.)
**Fix:** `const s = fs.createReadStream(full); s.on('error', () => { res.writeHead(500); res.end(); }); s.pipe(res);`

### [FIXED] 3. Report (`/r/`) and shell (`/`) routes bypass the loopback/Origin guard (`src/server/ui.ts:128–146`)
`localOnly()` + `tokenOk()` are enforced **only** inside `if (pathname.startsWith('/api/'))`. The
`/r/<file>.html` route serves **sensitive scan reports** (stored owner-only, `0600`, in `~/.dat`)
with no Host/Origin check. A DNS-rebinding origin that resolves to `127.0.0.1:<port>` becomes
same-origin and can read reports cross-origin; filenames are predictable (`<slug>-<YYYYMMDD-HHMMSS>`).
**Root cause (altitude):** the guard is coupled to a string prefix, not to the route. The Phase-2 SSE
`/scan/...` endpoints on the roadmap will sit outside `/api/` and silently ship unguarded.
**Fix:** apply `localOnly()` to `/r/` and `/` too, and make auth a per-route property (a small route
table `{method, path, auth}` with one dispatcher) instead of a prefix `if`. `serve.ts` shares the
`/r/` exposure; fix both via a shared helper (see #9).

### [FIXED] 4. Readiness checklist mislabels `datConfig`'s tier (`src/readiness.ts:139`)
```ts
const tier: InputTier = report.datConfigRequired ? 'critical' : 'best-practice';
```
`datConfigRequired` is a boolean flattening of a 3-valued tier. An operator can place `datConfig` in
the **highly-advised** tier via `preflight.highlyAdvised: [datConfig]`; `checkReadiness` then counts
it in `highlyAdvisedMissing` (correct), but `printReadiness` forces the printed line to
`best-practice` and pairs it with the hardcoded *"Optional … safe defaults apply"* consequence — so
the console output contradicts the computed readiness counts (and, if re-elevated to `critical`, the
"Optional" wording contradicts the ⛔ header). Latent before this change; the diff touches this block.
**Fix:** store the real `datConfigTier: InputTier` on the report and emit `datConfig` through the same
`missing`/`missingByTier` path as every other category; drop the `datConfigRequired` bool and the ternary.

### [FIXED] 5. UI swallows backend errors on option change (`src/server/uiHtml.ts`, `refreshReadiness`)
`analyze()` checks `res.ok`, but `refreshReadiness()` pipes the parsed body straight into
`renderReadiness(d)`. When `/api/readiness` returns `400 {error:…}` (e.g. the path became
invalid), `d.inputs` is `undefined`, so `d.inputs.length` throws a `TypeError` and the `.catch`
masks the real, actionable message behind a generic "Could not load readiness."
**Fix:** check `r.ok` in `refreshReadiness` and surface `data.error`, mirroring `analyze()`.

---

## P2 — Doc / contract staleness from the reclassification

### [FIXED] 6. `--strict-preflight` help still claims `config` is required (`src/index.ts:94`)
> "Abort the scan if a required input (Dockerfile / tests / DAST target / **config**) is missing"

After the reclassification a missing `.dat.config.yaml` no longer fails strict preflight. A CI author
relying on this to enforce config presence gets a silent pass. **Fix:** drop "/ config".

### [FIXED] 7. User manual still lists `.dat.config.yaml` as ⛔ Critical (`docs/USER_MANUAL.md:183`)
The readiness-tier table contradicts the new behavior (and the updated
`APP_READINESS_REQUIREMENTS.md`). **Fix:** move `.dat.config.yaml` to the best-practice row.

### [FIXED] 8. Stale comment on `criticalMissing` (`src/readiness.ts:28`)
`// distinct critical-tier categories missing (incl. .dat.config.yaml)` — no longer included.
**Fix:** drop the parenthetical.

---

## Cleanup / altitude (lower priority than correctness)

### [FIXED] 9. `/r/` report-serving duplicated across two drifting servers (`src/server/ui.ts:27,136–146` vs `src/server/serve.ts:33,51–61`)
The traversal-strip + `VALID_FILE` regex + `startsWith(dir+sep)` containment + `createReadStream` are
copied verbatim. This is the security boundary for serving files out of `~/.dat/reports`; a future
hardening applied to one server silently misses the other. **Fix:** extract
`resolveReportPath(name): string|null` / `serveReportFile(res, pathname)` into `library.ts`; both
servers call it (also fixes #2 and #3 in one place).

### [FIXED] 10. Per-request waste & misc cleanup (`src/server/ui.ts`)
- `buildReadiness` builds `new EnvironmentDetector(target)` twice (45–46) and doesn't pass
  `detectedLanguages` to `checkReadiness`, so `detectLanguages()` (incl. a `readdirSync` of the target
  root) runs **3×** per `/api/readiness`. Reuse one instance and thread `detectedLanguages` through.
- `/api/readiness` returns a `databases` array the SPA never reads — drop it.
- The tier-sort comparator rebuilds a `['critical','highly-advised','best-practice']` array per
  comparison — hoist a `TIER_ORDER` map.
- `ui` and `serve` command bodies duplicate the port parse/validate/`EADDRINUSE` boilerplate — extract
  `resolvePort()` into `library.ts`.
- `INSTALL_HINTS` (ui.ts:16) re-keys the scanner→binary registry; new scanners drift to the
  "install to enable" fallback. Consider an optional `installHint` on the scanner definition.

---

## Verified correct — no action (recorded so it isn't re-litigated)
- **No-`chdir` model is sound:** `loadConfig` gets an absolute path; `checkReadiness`, `isInputPresent`,
  and `EnvironmentDetector` all use the passed `workspaceRoot` — no `process.cwd()` leak.
- **Reclassification is structurally clean:** `DEFAULT_REQUIRED` aliases `DEFAULT_CRITICAL`,
  `--strict-preflight` keys on `requiredMissing`, auto-detect/`isNotApplicable` read tiers dynamically.
- **`ui.ts` keeps every `serve.ts` guard** (VALID regex, traversal containment, method checks) and adds
  loopback/Origin enforcement, a timing-safe token, and a 64 KB body cap.
- Build clean; readiness suite 6/6; `ui` auth-guard suite 8/8.
