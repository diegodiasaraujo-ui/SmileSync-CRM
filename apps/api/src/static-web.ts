import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import type { FastifyInstance } from "fastify";

const contentTypes: Readonly<Record<string, string>> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

export async function registerStaticWeb(app: FastifyInstance, directory: string) {
  const root = resolve(directory);
  const index = await readFile(join(root, "index.html"));

  app.get<{ Params: { "*": string } }>("/assets/*", async (request, reply) => {
    const name = request.params["*"];
    const type = contentTypes[extname(name)] ?? "";
    if (!/^[\w.-]+$/.test(name) || !type) return reply.callNotFound();
    const path = join(root, "assets", name);
    const file = await stat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!file?.isFile()) return reply.callNotFound();
    reply.header("Cache-Control", "public, max-age=31536000, immutable");
    return reply.type(type).send(createReadStream(path));
  });

  for (const path of ["/", "/cadastro", "/recuperar", "/onboarding", "/app", "/app/*"]) {
    app.get(path, async (_request, reply) =>
      reply.header("Cache-Control", "no-cache").type("text/html; charset=utf-8").send(index),
    );
  }
}
