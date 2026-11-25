import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const host = "127.0.0.1";
const demoEmail = "demo@smilesync.test";
const demoPassword = "SmileSyncDemo2026!";
const pnpmVersion = "11.25.0";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", ...options });
  if (result.error || result.status !== 0) {
    throw new Error("Uma etapa de preparação falhou. Veja a mensagem acima.");
  }
  return result;
}

function npmExec(args) {
  const npmCli = process.env.npm_execpath;
  if (npmCli?.endsWith(".js")) return [process.execPath, [npmCli, ...args]];
  return ["npm", args];
}

async function ensureAvailable(port) {
  const probe = createServer();
  await new Promise((resolveProbe, reject) => {
    probe.once("error", reject);
    probe.listen(port, host, () => probe.close(resolveProbe));
  }).catch((error) => {
    if (error.code === "EADDRINUSE") {
      throw new Error(
        `A porta ${port} está ocupada. Encerre a outra instância ou inicie com SMILESYNC_PORT=4175 npm start.`,
      );
    }
    throw new Error(`Não foi possível escutar em ${host}:${port} (${error.code ?? "erro local"}).`);
  });
}

async function openOnReady(origin, child) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const ready = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(750) })
      .then((response) => response.ok)
      .catch(() => false);
    if (ready) {
      const browser = spawn("open", [origin], { stdio: "ignore" });
      browser.on("error", () => console.log(`Abra ${origin} no navegador.`));
      browser.unref();
      return;
    }
    await delay(250);
  }
}

async function main() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 12)) {
    throw new Error(
      "O SmileSync precisa do Node.js 22.12 ou superior. Instale a versão LTS em https://nodejs.org/.",
    );
  }

  // Do not pass .env settings or integration secrets to install/build commands.
  const buildEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !/^(?:OMNI_|WHATSAPP_|OPENAI_|DATABASE_URL$)/.test(name),
    ),
  );
  buildEnv.npm_config_prefer_offline = "true";

  const envFile = resolve(root, ".env");
  if (existsSync(envFile)) loadEnvFile(envFile);
  const port = Number(process.env.SMILESYNC_PORT ?? "4173");
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("SMILESYNC_PORT precisa ser uma porta de 1024 a 65535.");
  }
  await ensureAvailable(port);

  const origin = `http://${host}:${port}`;
  const dbDir = resolve(root, process.env.SMILESYNC_DATA_DIR || "apps/api/.data/smilesync");
  const env = {
    ...process.env,
    NODE_ENV: "development",
    HOST: host,
    PORT: String(port),
    APP_ORIGIN: origin,
    DATABASE_URL: `pglite://${dbDir}`,
    MIGRATE_ON_START: "true",
    EXPOSE_TEST_RESET_TOKENS: "false",
    SMILESYNC_WEB_DIST: resolve(root, "apps/web/dist"),
  };

  const nodeApi = resolve(root, "apps/api/node_modules/typescript/bin/tsc");
  const nodeWebTypes = resolve(root, "apps/web/node_modules/typescript/bin/tsc");
  const nodeWeb = resolve(root, "apps/web/node_modules/vite/bin/vite.js");
  const npmArgs = ["exec", "--yes", `--package=pnpm@${pnpmVersion}`, "--", "pnpm"];
  const installedLock = resolve(root, "node_modules/.pnpm/lock.yaml");
  const dependenciesReady =
    [nodeApi, nodeWebTypes, nodeWeb, installedLock].every(existsSync) &&
    readFileSync(installedLock).equals(readFileSync(resolve(root, "pnpm-lock.yaml")));
  if (!dependenciesReady) {
    console.log("Preparando as dependências do SmileSync...");
    const [packageRunner, installArgs] = npmExec([
      ...npmArgs,
      "install",
      "--frozen-lockfile",
      "--prod=false",
    ]);
    run(packageRunner, installArgs, { env: buildEnv });
  }
  console.log("Compilando a API e a interface...");
  run(process.execPath, [nodeApi, "-p", "apps/api/tsconfig.json"], { env: buildEnv });
  run(process.execPath, [nodeWebTypes, "-p", "apps/web/tsconfig.json", "--noEmit"], {
    env: buildEnv,
  });
  run(process.execPath, [nodeWeb, "build"], { cwd: resolve(root, "apps/web"), env: buildEnv });

  if (process.env.SMILESYNC_SEED_DEMO !== "false") {
    const seeded = spawnSync(process.execPath, ["apps/api/dist/cli/seed-local.js"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...buildEnv,
        DATABASE_URL: env.DATABASE_URL,
        APP_ORIGIN: env.APP_ORIGIN,
      },
      stdio: ["ignore", "pipe", "inherit"],
    });
    if (seeded.status !== 0 || !seeded.stdout) {
      throw new Error("Não foi possível preparar o banco de demonstração.");
    }
    const { clinicId } = JSON.parse(seeded.stdout);
    if (env.WHATSAPP_PROVIDER === "zapi_omni" && !env.WHATSAPP_CLINIC_ID) {
      env.WHATSAPP_CLINIC_ID = clinicId;
    }
    console.log(`Conta local de demonstração: ${demoEmail} / ${demoPassword}`);
    console.log(`Clínica de demonstração: ${clinicId}`);
  }

  console.log(`SmileSync: ${origin}`);
  console.log("Para encerrar, pressione Ctrl+C.");
  const child = spawn(process.execPath, ["apps/api/dist/server.js"], {
    cwd: root,
    env,
    stdio: "inherit",
  });
  const signals = ["SIGINT", "SIGTERM"];
  const listeners = signals.map((signal) => [signal, () => child.kill(signal)]);
  for (const [signal, listener] of listeners) process.on(signal, listener);
  if (
    process.platform === "darwin" &&
    process.argv.includes("--open") &&
    process.env.SMILESYNC_OPEN_BROWSER !== "false"
  ) {
    void openOnReady(origin, child);
  }
  try {
    const result = await new Promise((resolveChild, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolveChild(code ?? (signal === "SIGINT" ? 0 : 1)));
    });
    process.exitCode = result;
  } finally {
    for (const [signal, listener] of listeners) process.off(signal, listener);
  }
}

try {
  await main();
} catch (error) {
  console.error(`SmileSync: ${error.message}`);
  process.exitCode = 1;
}
