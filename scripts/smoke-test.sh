#!/bin/bash
set -e

echo "💨 Running Smoke Tests..."

# Test 1: Can it show help without crashing?
node dist/index.js --help > /dev/null
echo "✔ Help command executed successfully."

# Test 2: Can it output version?
VERSION=$(node dist/index.js --version)
if [[ $VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "✔ Version command executed successfully: $VERSION"
else
    echo "❌ Version command failed. Output: $VERSION"
    exit 1
fi

echo "✅ All smoke tests passed! CLI boots up properly."
