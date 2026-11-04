import { mkdirSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";

export type SqlParameter = string | number | boolean | Date | null | string[];

export type QueryResult<Row extends Record<string, unknown> = Record<string, unknown>> = {
  rows: Row[];
  rowCount: number;
};

export interface DatabaseExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters?: SqlParameter[],
  ): Promise<QueryResult<Row>>;
  exec(sql: string): Promise<void>;
}

export interface Database extends DatabaseExecutor {
  readonly kind: "pglite" | "postgres";
  transaction<Result>(work: (client: DatabaseExecutor) => Promise<Result>): Promise<Result>;
  close(): Promise<void>;
}

class PostgresDatabase implements Database {
  readonly kind = "postgres" as const;
  constructor(private readonly pool: pg.Pool) {}

  async query<Row extends Record<string, unknown>>(
    sql: string,
    parameters: SqlParameter[] = [],
  ): Promise<QueryResult<Row>> {
    const result = await this.pool.query(sql, parameters);
    return { rows: result.rows as Row[], rowCount: result.rowCount ?? 0 };
  }

  async exec(sql: string) {
    await this.pool.query(sql);
  }

  async transaction<Result>(work: (client: DatabaseExecutor) => Promise<Result>) {
    const connection = await this.pool.connect();
    try {
      await connection.query("BEGIN");
      const result = await work({
        query: async <Row extends Record<string, unknown>>(
          sql: string,
          parameters: SqlParameter[] = [],
        ) => {
          const query = await connection.query(sql, parameters);
          return { rows: query.rows as Row[], rowCount: query.rowCount ?? 0 };
        },
        exec: async (sql: string) => {
          await connection.query(sql);
        },
      });
      await connection.query("COMMIT");
      return result;
    } catch (error) {
      await connection.query("ROLLBACK");
      throw error;
    } finally {
      connection.release();
    }
  }

  async close() {
    await this.pool.end();
  }
}

class PGliteDatabase implements Database {
  readonly kind = "pglite" as const;
  constructor(private readonly client: PGlite) {}

  async query<Row extends Record<string, unknown>>(
    sql: string,
    parameters: SqlParameter[] = [],
  ): Promise<QueryResult<Row>> {
    const result = await this.client.query<Row>(sql, parameters);
    return {
      rows: result.rows,
      rowCount: result.rows.length > 0 ? result.rows.length : (result.affectedRows ?? 0),
    };
  }

  async exec(sql: string) {
    await this.client.exec(sql);
  }

  async transaction<Result>(work: (client: DatabaseExecutor) => Promise<Result>) {
    return this.client.transaction(async (transaction) =>
      work({
        query: async <Row extends Record<string, unknown>>(
          sql: string,
          parameters: SqlParameter[] = [],
        ) => {
          const result = await transaction.query<Row>(sql, parameters);
          return {
            rows: result.rows,
            rowCount: result.rows.length > 0 ? result.rows.length : (result.affectedRows ?? 0),
          };
        },
        exec: async (sql: string) => {
          await transaction.exec(sql);
        },
      }),
    );
  }

  async close() {
    await this.client.close();
  }
}

export function createDatabase(databaseUrl: string): Database {
  if (databaseUrl.startsWith("postgresql://") || databaseUrl.startsWith("postgres://")) {
    return new PostgresDatabase(
      new pg.Pool({
        connectionString: databaseUrl,
        max: 10,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
        allowExitOnIdle: false,
      }),
    );
  }
  if (!databaseUrl.startsWith("pglite://"))
    throw new Error("DATABASE_URL deve usar postgresql://, postgres:// ou pglite://.");
  const location = databaseUrl.slice("pglite://".length);
  if (location === "memory") return new PGliteDatabase(new PGlite());
  const dataDirectory = resolve(location);
  mkdirSync(dirname(dataDirectory), { recursive: true });
  return new PGliteDatabase(new PGlite(dataDirectory));
}

const defaultMigrationsDirectory = fileURLToPath(new URL("../migrations", import.meta.url));

export async function migrateDatabase(
  database: Database,
  migrationsDirectory = defaultMigrationsDirectory,
) {
  await database.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const files = (await readdir(migrationsDirectory))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort((left, right) => left.localeCompare(right));
  const applied = new Set(
    (await database.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map(
      ({ name }) => name,
    ),
  );
  for (const name of files) {
    if (applied.has(name)) continue;
    if (database.kind === "pglite" && name.includes("postgres_hardening")) continue;
    const source = await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8").catch(
      async () => readFile(`${migrationsDirectory}/${name}`, "utf8"),
    );
    const sql = source.replace(/^\s*BEGIN\s*;\s*/i, "").replace(/\s*COMMIT\s*;\s*$/i, "");
    await database.transaction(async (transaction) => {
      await transaction.exec(sql);
      await transaction.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
    });
  }
}
