#!/usr/bin/env bash
# restart.sh — Detached restart for Aerie
# Survives the death of the calling process (safe to call from inside the agent)
#
# Usage:
#   ./scripts/restart.sh              # restart only
#   ./scripts/restart.sh --build      # build all packages then restart
#   ./scripts/restart.sh --phone      # build the phone UI only then restart
#   ./scripts/restart.sh --backend    # build backend only then restart

set -e
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
LOG="$ROOT/logs/restart.log"

mkdir -p "$ROOT/logs"

echo "[$(date -Iseconds)] restart.sh invoked with args: $*" >> "$LOG"

do_build_phone=false
do_build_backend=false

for arg in "$@"; do
  case "$arg" in
    --build)    do_build_phone=true; do_build_backend=true ;;
    --phone)    do_build_phone=true ;;
    --frontend) do_build_phone=true ;;  # legacy name
    --backend)  do_build_backend=true ;;
    *)          echo "Unknown arg: $arg"; exit 1 ;;
  esac
done

# Build phase (runs in foreground so errors are visible)
if $do_build_phone; then
  echo "[$(date -Iseconds)] Building shared + phone..." >> "$LOG"
  npm run build --workspace=packages/shared 2>&1 >> "$LOG" || true
  npm run build --workspace=packages/phone 2>&1 >> "$LOG"
  echo "[$(date -Iseconds)] Phone build complete" >> "$LOG"
fi

if $do_build_backend; then
  echo "[$(date -Iseconds)] Building shared + backend..." >> "$LOG"
  npm run build --workspace=packages/shared 2>&1 >> "$LOG" || true
  npm run build --workspace=packages/backend 2>&1 >> "$LOG"
  echo "[$(date -Iseconds)] Backend build complete" >> "$LOG"
fi

# Restart phase — detached so the calling process can die safely
echo "[$(date -Iseconds)] Scheduling PM2 restart (1s delay, detached)..." >> "$LOG"

nohup bash -c '
  sleep 1
  pm2 restart aerie 2>&1 >> '"$LOG"'
  echo "[$(date -Iseconds)] PM2 restart complete" >> '"$LOG"'
' >> "$LOG" 2>&1 &

# Disown so the child survives our exit
disown

echo "[$(date -Iseconds)] restart.sh exiting (PM2 restart scheduled)" >> "$LOG"
echo "Restart scheduled. Server will be back in ~3 seconds."
