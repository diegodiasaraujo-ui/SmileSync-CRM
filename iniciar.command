#!/bin/zsh

cd -- "${0:A:h}" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v npm >/dev/null 2>&1; then
  echo "Instale o Node.js LTS em https://nodejs.org/ e abra este arquivo novamente."
  read "?Pressione Enter para fechar..."
  exit 1
fi

npm start -- --open
status=$?
if (( status != 0 )); then
  read "?Pressione Enter para fechar..."
fi
exit $status
