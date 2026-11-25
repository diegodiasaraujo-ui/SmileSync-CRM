import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { registerStaticWeb } from "./static-web.js";

const config = loadConfig();
const app = await buildApp({ config });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "encerrando API");
  await app.close();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  if (process.env.SMILESYNC_WEB_DIST) await registerStaticWeb(app, process.env.SMILESYNC_WEB_DIST);
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exit(1);
}
