#!/bin/zsh
set -e

cd "${0:A:h}"

if ! command -v node >/dev/null 2>&1; then
  echo "ERRO: Node.js 22.12 ou superior não foi encontrado."
  echo "Instale a versão LTS em https://nodejs.org/ e execute este arquivo novamente."
  read "?Pressione Enter para fechar..."
  exit 1
fi

node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 12)) { console.error("ERRO: use Node.js 22.12 ou superior. Versão atual: " + process.versions.node); process.exit(1); }'

run_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    pnpm "$@"
  elif command -v corepack >/dev/null 2>&1; then
    corepack pnpm "$@"
  else
    echo "ERRO: pnpm/Corepack não foi encontrado. Execute: npm install -g pnpm@11.25.0"
    exit 1
  fi
}

echo "Preparando o SmileSync..."
run_pnpm install --frozen-lockfile

(sleep 4; open "http://127.0.0.1:4173") &

echo "Iniciando frontend, API e banco local..."
echo "Para encerrar, pressione Control+C."
run_pnpm start
