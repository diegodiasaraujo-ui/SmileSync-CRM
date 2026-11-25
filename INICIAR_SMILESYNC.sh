#!/usr/bin/env sh
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$PROJECT_DIR"

if ! command -v npm >/dev/null 2>&1; then
  echo "ERRO: instale Node.js 22.12 ou superior em https://nodejs.org/"
  exit 1
fi

exec npm start -- "$@"
