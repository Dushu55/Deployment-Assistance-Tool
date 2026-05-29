#!/bin/bash
set -e

echo "============================================"
echo " DAT End-to-End Pipeline Integration Test   "
echo "============================================"

# Ensure dist exists
if [ ! -d "dist" ]; then
    echo "Compiling TypeScript..."
    npm run build
fi

# Clean previous results
rm -rf results/
mkdir -p results/

# Run the CLI against the testing_data directory with all exporters enabled
echo "Executing DAT CLI..."
node dist/index.js scan -u https://example.com --sarif results/e2e-report.sarif --csv results/e2e-report.csv --pdf results/e2e-report.pdf || true

# Assertions
echo "\n============================================"
echo " Validating Output Artifacts                "
echo "============================================"

if [ -f "results/e2e-report.sarif" ]; then
    echo "✅ SARIF generated successfully."
    grep -q '"version": "2.1.0"' results/e2e-report.sarif || { echo "❌ SARIF is invalid format!"; exit 1; }
    echo "  ↳ Format validated."
else
    echo "❌ SARIF missing!"
    exit 1
fi

if [ -f "results/e2e-report.csv" ]; then
    echo "✅ CSV generated successfully."
    grep -q 'Scanner,ID,Severity' results/e2e-report.csv || { echo "❌ CSV header missing!"; exit 1; }
    echo "  ↳ Headers validated."
else
    echo "❌ CSV missing!"
    exit 1
fi

if [ -f "results/e2e-report.pdf" ]; then
    echo "✅ PDF generated successfully."
else
    echo "❌ PDF missing!"
    exit 1
fi

echo "✅ End-to-End Pipeline Test Passed."
