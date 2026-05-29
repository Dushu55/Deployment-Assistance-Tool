# DAT Application Component Model (Phase 2)

The Component Model is DAT's typed inventory of what a deployable application is *made of* —
UI controls, the API calls they make, the backend endpoints those calls hit, and the network
resources that expose them. It turns a flat pile of files into a **graph of components**, so the
Phase 3 evaluators can ask per-component questions like *"does this submit button handle the
error/loading path?"*, *"does this state-changing endpoint require auth?"*, *"is this security
group open to the world?"*.

This is the conceptual foundation for the stakeholder requirement of evaluating *"fail-safe
attributes in each component (buttons, inputs, API calls, network configurations)"*.

## Generating the model

Standalone (no scanners):
```bash
node dist/index.js model --out results/dat-component-model.json
```

As part of a scan (also links findings to components in the fix manifest):
```bash
node dist/index.js scan --component-model results/dat-component-model.json --fix-manifest results/dat-fix-manifest.json
```

## What it captures (V1)

| Extractor | Source | Node kinds | Key attributes |
|---|---|---|---|
| `react` | React/JSX (`.tsx/.jsx`) + JS/TS for calls | `Button`, `Input`, `Form`, `ApiCall` | onClick, controlled `disabled`, input validation (required/pattern/maxLength/type), submit type; per call: method, url, `hasErrorHandling`, `hasTimeout`, `hasAuthHeader` |
| `api` | Express/Fastify routes, Next.js (app-router + pages/api) | `ApiEndpoint` | method, normalized path, `isStateChanging`, `hasAuthMiddleware` |
| `network` | Terraform (`.tf`, AWS) | `NetworkResource` | `openToWorld`, `ingressPorts`, `ingressCidrs`, `exposesSensitivePort` |

### Cross-stack linkage
The builder links a client `ApiCall` to the backend `ApiEndpoint` it targets by matching the
**normalized path + method** (`/api/users/123` → `GET /api/users/:param`). These `calls` edges let
an evaluator reason across the front/back boundary — e.g. "a UI call hits a state-changing endpoint
that has no auth middleware."

## Schema (v1.0)

```jsonc
{
  "schemaVersion": "1.0",
  "generatedAt": "2026-05-30T...",
  "ecosystem": { "frontend": ["react"], "backend": ["rest"], "iac": ["terraform"] },
  "nodes": [
    { "id": "Button:web/Page.tsx:3:0", "kind": "Button", "label": "button type=submit",
      "location": { "file": "web/Page.tsx", "line": 3 },
      "attributes": { "hasOnClick": true, "disabledControlled": true, "isSubmit": true } }
  ],
  "edges": [ { "from": "ApiCall:...", "to": "ApiEndpoint:...", "kind": "calls" } ],
  "coverage": [ { "extractor": "api", "filesScanned": 12, "nodesFound": 7, "note": "..." } ]
}
```

Finding → component attribution: when a scan emits both a component model and a fix manifest, each
finding gets a `componentRef` (the id of the nearest component in the same file), so an agent fixing
a finding knows which UI/endpoint/resource it belongs to.

## Honesty about coverage (V1 limitations)

Extraction is **heuristic** (regex/structural), consistent with the reachability engine, and every
extractor reports what it did and didn't cover in `coverage[]`. Known limits, tracked for the AST
upgrade:
- JSX: dynamic/spread props and templated URLs are best-effort; deeply nested component trees aren't
  fully resolved.
- API: dynamically-registered routes and middleware applied via `app.use(...)` chains aren't traced;
  auth is inferred from identifier hints on the route line.
- Network: AWS only; Terraform variables/modules aren't resolved; other clouds are TODO.
- `submits` edges (button/form → specific ApiCall) are not yet inferred.

These are deliberately surfaced rather than hidden — a gap in the model is reported, never silently
assumed complete. The schema is extractor-agnostic, so an AST-based implementation can replace the
heuristics without changing consumers.
