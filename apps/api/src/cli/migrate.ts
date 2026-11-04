import { loadConfig } from "../config.js";
import { createDatabase, migrateDatabase } from "../database.js";

const config = loadConfig();
const database = createDatabase(config.databaseUrl);

try {
  await migrateDatabase(database);
  process.stdout.write("Migrações aplicadas com sucesso.\n");
} finally {
  await database.close();
}
