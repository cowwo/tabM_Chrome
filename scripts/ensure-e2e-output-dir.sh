#!/usr/bin/env bash
# scripts/ensure-e2e-output-dir.sh
# 确保 headed E2E 输出目录存在且当前用户可写

set -euo pipefail

OUTPUT_DIR="${PLAYWRIGHT_OUTPUT_DIR:-/tmp/tabm-e2e/latest}"
mkdir -p "$OUTPUT_DIR"

echo "e2e output dir: $OUTPUT_DIR"
echo "writable: $(test -w "$OUTPUT_DIR" && echo yes || echo NO -- will fail)"
