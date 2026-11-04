@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo ERRO: Node.js 22.12 ou superior nao foi encontrado.
  echo Instale a versao LTS em https://nodejs.org/ e tente novamente.
  pause
  exit /b 1
)

node -e "const [a,b]=process.versions.node.split('.').map(Number);if(a^<22 ^|^| (a===22 ^&^& b^<12)){console.error('ERRO: use Node.js 22.12 ou superior. Versao atual: '+process.versions.node);process.exit(1)}"
if errorlevel 1 (
  pause
  exit /b 1
)

where pnpm >nul 2>nul
if errorlevel 1 (
  where corepack >nul 2>nul
  if errorlevel 1 (
    echo ERRO: pnpm/Corepack nao foi encontrado.
    echo Execute: npm install -g pnpm@11.25.0
    pause
    exit /b 1
  )
  set "PNPM=corepack pnpm"
) else (
  set "PNPM=pnpm"
)

echo Preparando o SmileSync...
call %PNPM% install --frozen-lockfile
if errorlevel 1 (
  pause
  exit /b 1
)

start "" cmd /c "timeout /t 4 /nobreak >nul & start http://127.0.0.1:4173"
echo Iniciando frontend, API e banco local...
echo Para encerrar, pressione Ctrl+C.
call %PNPM% start
