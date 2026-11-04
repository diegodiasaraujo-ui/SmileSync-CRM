#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."

export HOST=0.0.0.0
export APP_ORIGIN="https://${CODESPACE_NAME}-4173.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
export SMILESYNC_API_URL=http://127.0.0.1:3001

if curl -fsS --max-time 2 http://127.0.0.1:3001/api/health >/dev/null 2>&1 &&
   curl -fsS --max-time 2 http://127.0.0.1:4173/ >/dev/null 2>&1; then
  echo "SmileSync ja esta funcionando."
  exit 0
fi

nohup npx --yes pnpm@11.25.0 dev >/tmp/smilesync.log 2>&1 </dev/null &

echo "SmileSync iniciando automaticamente."
