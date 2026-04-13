#!/usr/bin/env bash
# SIGNA — one-command local launch.
# Populates DB with synthetic demo data, starts API server, opens the dashboard.
# Exit with Ctrl+C. Re-run anytime.

set -e
cd "$(dirname "$0")"

export SIGNA_DEMO=${SIGNA_DEMO:-0}
export WATCHLIST=${WATCHLIST:-AAPL,NVDA,TSLA,AMD,SOFI,AMZN,GME,MSFT,META,GOOGL}
export DB_PATH=${DB_PATH:-./signa.db}
export PORT=${PORT:-4000}

if [ ! -d node_modules ]; then
  echo "→ Installing dependencies..."
  npm install --no-audit --no-fund
fi

echo "→ Populating database (demo mode: $SIGNA_DEMO)..."
node --experimental-sqlite ./one-shot-scan.mjs

echo ""
echo "→ Starting API + dashboard on http://localhost:$PORT"
echo "  Open this URL in your browser:"
echo ""
echo "     http://localhost:$PORT"
echo ""
echo "  Press Ctrl+C to stop."
echo ""

node --experimental-sqlite src/api/server.js
