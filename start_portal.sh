#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=========================================================="
echo "  Starting Cloud Storage Portal (Production / Local Dev)  "
echo "=========================================================="

# 0. Clean old processes on ports 8000 and 5180
fuser -k 8000/tcp 2>/dev/null || true
fuser -k 5180/tcp 2>/dev/null || true
sleep 1

# 1. Run database migrations to ensure schema is up-to-date
echo "[1/3] Checking database migrations..."
cd "$DIR/backend"
PYTHONPATH=. .venv/bin/alembic upgrade head

# 2. Launch FastAPI backend on port 8000
echo "[2/3] Launching FastAPI Backend on http://0.0.0.0:8000..."
PYTHONPATH=. .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

# 3. Launch Vite Frontend on port 5180
echo "[3/3] Launching React Vite Frontend on http://0.0.0.0:5180..."
cd "$DIR/frontend"
npm run dev -- --host 0.0.0.0 --port 5180 &
FRONTEND_PID=$!

cleanup() {
    echo ""
    echo "Shutting down Cloud Storage Portal services..."
    kill "$BACKEND_PID" 2>/dev/null || true
    kill "$FRONTEND_PID" 2>/dev/null || true
    echo "Services stopped cleanly."
}

trap cleanup INT TERM

echo ""
echo "=========================================================="
echo "  Cloud Storage Portal is RUNNING!                        "
echo "  Frontend UI:  http://localhost:5180                     "
echo "  Backend API:  http://localhost:8000                     "
echo "  API Docs:     http://localhost:8000/docs                "
echo "=========================================================="
echo "Press Ctrl+C to terminate both servers."
echo ""

wait
