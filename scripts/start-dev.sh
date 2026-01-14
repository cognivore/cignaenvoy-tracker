#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PID_DIR="$PROJECT_ROOT/.dev-pids"
LOG_DIR="$PROJECT_ROOT/.dev-logs"

mkdir -p "$PID_DIR" "$LOG_DIR"

echo "Starting cignaenvoy-tracker development servers..."

# Check if already running
if [ -f "$PID_DIR/backend.pid" ]; then
  EXISTING_PID=$(cat "$PID_DIR/backend.pid")
  if kill -0 "$EXISTING_PID" 2>/dev/null; then
    echo "Backend already running (PID: $EXISTING_PID)"
    echo "Run scripts/stop-dev.sh first"
    exit 1
  fi
fi

# Fetch Cigna credentials from passveil
echo "Fetching Cigna credentials from passveil..."
CREDS=$(passveil show customer.cignaenvoy.com/tracker-credentials)
export CIGNA_ID=$(echo "$CREDS" | head -1)
export CIGNA_PASSWORD=$(echo "$CREDS" | tail -1)
export CIGNA_TOTP_SECRET=$(passveil show customer.cignaenvoy.com/totp-secret)
echo "  ✓ Credentials loaded"

# Start backend
echo "Starting backend API server..."
cd "$PROJECT_ROOT"
nix develop --command env \
  CIGNA_ID="$CIGNA_ID" \
  CIGNA_PASSWORD="$CIGNA_PASSWORD" \
  CIGNA_TOTP_SECRET="$CIGNA_TOTP_SECRET" \
  npx tsx src/server/api.ts > "$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!
echo $BACKEND_PID > "$PID_DIR/backend.pid"
echo "  Backend started (PID: $BACKEND_PID, logs: $LOG_DIR/backend.log)"

# Wait for backend to initialize
sleep 2

# Check backend started ok
if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
  echo "  ❌ Backend failed to start. Check logs:"
  tail -20 "$LOG_DIR/backend.log"
  exit 1
fi

# Start frontend
echo "Starting frontend dev server..."
cd "$PROJECT_ROOT/frontend"
nix develop --command pnpm dev > "$LOG_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!
echo $FRONTEND_PID > "$PID_DIR/frontend.pid"
echo "  Frontend started (PID: $FRONTEND_PID, logs: $LOG_DIR/frontend.log)"

# Wait for frontend to initialize
sleep 2

# Check frontend started ok
if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
  echo "  ❌ Frontend failed to start. Check logs:"
  tail -20 "$LOG_DIR/frontend.log"
  exit 1
fi

echo ""
echo "✓ Development servers running"
echo "  Backend:  http://localhost:3001"
echo "  Frontend: http://localhost:3000"
echo ""
echo "To stop: run scripts/stop-dev.sh"
echo "To view logs:"
echo "  Backend:  tail -f $LOG_DIR/backend.log"
echo "  Frontend: tail -f $LOG_DIR/frontend.log"
