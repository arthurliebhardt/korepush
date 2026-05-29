#!/bin/sh
set -e

echo "[kubepush] running database migrations…"
node migrate.mjs

echo "[kubepush] starting control plane on :${PORT:-3000}"
exec node apps/web/server.js
