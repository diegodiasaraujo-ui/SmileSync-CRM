import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { expect, it } from "vitest";
import { registerStaticWeb } from "./static-web.js";

it("serve o frontend e os assets sem transformar erros da API em HTML", async () => {
  const directory = await mkdtemp(join(tmpdir(), "smilesync-static-test-"));
  const app = Fastify();
  try {
    await mkdir(join(directory, "assets"));
    await writeFile(join(directory, "index.html"), "<title>SmileSync</title>");
    await writeFile(join(directory, "assets", "app-abc.js"), "export {};");
    await writeFile(join(directory, ".env"), "fake-secret");
    app.get("/api/health", async () => ({ status: "ok" }));
    await registerStaticWeb(app, directory);
    const page = await app.inject("/app/whatsapp");
    expect(page.statusCode).toBe(200);
    expect(page.headers["content-type"]).toMatch(/^text\/html/);
    expect(page.body).toContain("SmileSync");
    const asset = await app.inject("/assets/app-abc.js");
    expect(asset.headers["content-type"]).toMatch(/^text\/javascript/);
    expect(asset.body).toBe("export {};");
    expect((await app.inject("/assets/absent.js")).statusCode).toBe(404);
    expect((await app.inject("/assets/%2e%2e%2f.env")).statusCode).toBe(404);
    expect((await app.inject("/.env")).statusCode).toBe(404);
    expect((await app.inject("/api/health")).json()).toEqual({ status: "ok" });
    const missingApi = await app.inject("/api/absent");
    expect(missingApi.statusCode).toBe(404);
    expect(missingApi.headers["content-type"]).toMatch(/^application\/json/);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
