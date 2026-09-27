#!/usr/bin/env bash
set -e

echo "Installing backend dependencies..."
pip install --upgrade pip
pip install -r requirements.txt

echo "Build phase complete."
