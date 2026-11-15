// Creates .env.local with a password and secrets, keeping any values already set.
import { randomBytes } from "node:crypto";
import fs from "node:fs";

const FILE = ".env.local";

const existing = fs.existsSync(FILE)
  ? fs
      .readFileSync(FILE, "utf8")
      .split("\n")
      .filter((line) => /^[A-Z_]+=/.test(line) && !line.startsWith("VERCEL_"))
  : [];

const has = (key) => existing.some((line) => line.startsWith(`${key}=`));
const secret = (bytes) => randomBytes(bytes).toString("base64url");

const added = [];
for (const [key, value] of [
  ["APP_PASSWORD", secret(9)],
  ["SESSION_SECRET", secret(32)],
  ["CAPTURE_TOKEN", secret(24)],
]) {
  if (!has(key)) {
    existing.push(`${key}=${value}`);
    added.push(key);
  }
}

fs.writeFileSync(FILE, `${existing.join("\n")}\n`, { mode: 0o600 });
console.log(
  added.length
    ? `Added ${added.join(", ")} to ${FILE}. Your password is in that file, and you can change it there.`
    : `${FILE} already has everything it needs.`,
);
