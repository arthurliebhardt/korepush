#!/bin/sh
set -e

echo "[korepush] running database migrations…"
node migrate.mjs

echo "[korepush] starting control plane on :${PORT:-3000}"
exec node apps/web/server.js
