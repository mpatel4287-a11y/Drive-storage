#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$DIR/logs"
mkdir -p "$LOG_DIR"

echo "=========================================================="
echo "    Launching Cloud Storage Portal (Online Mode)          "
echo "=========================================================="

# 1. Run database migrations
echo "[1/4] Checking database migrations..."
cd "$DIR/backend"
PYTHONPATH=. .venv/bin/alembic upgrade head > /dev/null

# 2. Launch FastAPI backend on port 8000
echo "[2/4] Starting Backend API on http://127.0.0.1:8000..."
PYTHONPATH=. .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 > "$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!

# 3. Launch React Vite frontend on port 5173
echo "[3/4] Starting Frontend on http://127.0.0.1:5173..."
cd "$DIR/frontend"
npm run dev -- --host 127.0.0.1 --port 5173 > "$LOG_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!

# Give servers 2 seconds to initialize
sleep 2

# 4. Launch Cloudflare Tunnel
echo "[4/4] Starting Cloudflare HTTPS Tunnel..."
TUNNEL_LOG="$LOG_DIR/cloudflared.log"
cloudflared tunnel --url http://localhost:5173 > "$TUNNEL_LOG" 2>&1 &
TUNNEL_PID=$!

cleanup() {
    echo ""
    echo "Shutting down online services..."
    kill "$TUNNEL_PID" 2>/dev/null || true
    kill "$BACKEND_PID" 2>/dev/null || true
    kill "$FRONTEND_PID" 2>/dev/null || true
    echo "All services stopped."
    exit 0
}

trap cleanup INT TERM

# Wait for public tunnel URL to appear in the log (up to 15 seconds)
PUBLIC_URL=""
for i in {1..15}; do
    PUBLIC_URL=$(grep -o 'https://[a-zA-Z0-9-]*\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -1 || true)
    if [ -n "$PUBLIC_URL" ]; then
        break
    fi
    sleep 1
done

echo ""
echo "=========================================================="
if [ -n "$PUBLIC_URL" ]; then
    echo "  🎉 YOUR WEBSITE IS NOW ONLINE AND GLOBALLY ACCESSIBLE!"
    echo ""
    echo "  Public URL:   $PUBLIC_URL"
    echo "  Local UI:     http://localhost:5173"
    echo "  Local API:    http://localhost:8000"
else
    echo "  ⚠️ Tunnel started, check $TUNNEL_LOG for URL."
    echo "  Local UI:     http://localhost:5173"
fi
echo "=========================================================="
echo "Press Ctrl+C to stop the online portal."
echo ""

wait "$TUNNEL_PID"
