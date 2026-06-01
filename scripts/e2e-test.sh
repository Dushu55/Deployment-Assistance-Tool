#!/bin/bash
set -e

echo "============================================"
echo " DAT End-to-End Pipeline Integration Test   "
echo "============================================"

# Build if needed.
if [ ! -d "dist" ]; then
  echo "Compiling TypeScript..."
  npm run build
fi

# Clean previous results.
rm -rf results/
mkdir -p results/

# Run the full pipeline with EVERY exporter enabled. Notes:
#  - We scan the repo (which includes deliberately-vulnerable testing_data fixtures), so the quality
#    gate is expected to fail → `|| true` keeps the e2e about artifact generation, not the gate.
#  - The core engine (component evaluators, logic tests, reporters) is built-in and needs no external
#    scanner binaries, so this validates the pipeline even on a machine with no scanners installed;
#    any missing scanner tool is simply SKIPPED by preflight.
echo "Executing DAT CLI (all exporters)..."
node dist/index.js scan \
  --skip-preflight \
  --url https://example.com \
  --sarif results/e2e-report.sarif \
  --csv results/e2e-report.csv \
  --pdf results/e2e-report.pdf \
  --html results/e2e-report.html \
  --fix-manifest results/e2e-fix-manifest.json \
  --component-model results/e2e-component-model.json || true

echo ""
echo "============================================"
echo " Validating Output Artifacts                "
echo "============================================"

fail() { echo "❌ $1"; exit 1; }

# 1. SARIF
[ -f results/e2e-report.sarif ] || fail "SARIF missing!"
grep -q '"version": "2.1.0"' results/e2e-report.sarif || fail "SARIF invalid (missing version 2.1.0)"
echo "✅ SARIF generated + format validated."

# 2. CSV
[ -f results/e2e-report.csv ] || fail "CSV missing!"
grep -q 'Scanner,ID,Severity' results/e2e-report.csv || fail "CSV header missing"
echo "✅ CSV generated + headers validated."

# 3. PDF
[ -f results/e2e-report.pdf ] || fail "PDF missing!"
echo "✅ PDF generated."

# 4. HTML (self-explaining stakeholder report)
[ -f results/e2e-report.html ] || fail "HTML missing!"
grep -q 'How to read this report' results/e2e-report.html || fail "HTML missing the explainability section"
echo "✅ HTML generated + explainability section present."

# 5. Fix manifest (Claude-consumable) — validate JSON + key fields via node.
[ -f results/e2e-fix-manifest.json ] || fail "Fix manifest missing!"
node -e '
  const m = require("./results/e2e-fix-manifest.json");
  if (m.schemaVersion !== "1.0") throw new Error("bad schemaVersion");
  if (!m.glossary || !m.glossary.severities) throw new Error("missing glossary");
  if (!Array.isArray(m.findings)) throw new Error("findings not an array");
' || fail "Fix manifest invalid (schemaVersion/glossary/findings)"
echo "✅ Fix manifest generated + schema validated."

# 6. Component model (Phase 2 graph)
[ -f results/e2e-component-model.json ] || fail "Component model missing!"
node -e '
  const g = require("./results/e2e-component-model.json");
  if (!Array.isArray(g.nodes) || !Array.isArray(g.edges)) throw new Error("bad graph shape");
' || fail "Component model invalid (nodes/edges)"
echo "✅ Component model generated + graph shape validated."

echo ""
echo "✅ End-to-End Pipeline Test Passed — all 6 artifacts produced and validated."
