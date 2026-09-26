#!/usr/bin/env bash
set -e

echo "Installing backend dependencies..."
pip install --upgrade pip
pip install -r requirements.txt

echo "Applying database migrations..."
alembic upgrade head

echo "Backend build completed successfully!"
