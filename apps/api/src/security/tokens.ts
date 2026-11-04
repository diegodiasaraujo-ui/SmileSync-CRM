import { createHash, randomBytes } from "node:crypto";

export function createOpaqueToken(bytes = 32) {
  const token = randomBytes(bytes).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
