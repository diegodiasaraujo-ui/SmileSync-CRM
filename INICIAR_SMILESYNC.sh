#!/usr/bin/env sh
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$PROJECT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "ERRO: instale Node.js 22.12 ou superior em https://nodejs.org/"
  exit 1
fi

node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 12)) { console.error("ERRO: use Node.js 22.12 ou superior. Versão atual: " + process.versions.node); process.exit(1); }'

run_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    pnpm "$@"
  elif command -v corepack >/dev/null 2>&1; then
    corepack pnpm "$@"
  else
    echo "ERRO: instale pnpm com: npm install -g pnpm@11.25.0"
    exit 1
  fi
}

run_pnpm install --frozen-lockfile
run_pnpm start
