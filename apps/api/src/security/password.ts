import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";

const keyLength = 64;
const cost = 16_384;
const blockSize = 8;
const parallelization = 1;
const maxMemory = 64 * 1024 * 1024;

function derive(password: string, salt: Buffer, parameters = { cost, blockSize, parallelization }) {
  return new Promise<Buffer>((resolve, reject) => {
    nodeScrypt(
      password.normalize("NFKC"),
      salt,
      keyLength,
      {
        N: parameters.cost,
        r: parameters.blockSize,
        p: parameters.parallelization,
        maxmem: maxMemory,
      },
      (error, result) => (error ? reject(error) : resolve(result as Buffer)),
    );
  });
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = await derive(password, salt);
  return [
    "scrypt",
    cost,
    blockSize,
    parallelization,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, costValue, blockValue, parallelValue, saltValue, hashValue] =
    encoded.split("$");
  if (
    algorithm !== "scrypt" ||
    !costValue ||
    !blockValue ||
    !parallelValue ||
    !saltValue ||
    !hashValue
  )
    return false;
  const expected = Buffer.from(hashValue, "base64url");
  if (expected.length !== keyLength) return false;
  const actual = await derive(password, Buffer.from(saltValue, "base64url"), {
    cost: Number(costValue),
    blockSize: Number(blockValue),
    parallelization: Number(parallelValue),
  });
  return timingSafeEqual(actual, expected);
}
