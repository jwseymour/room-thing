import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { DATA_DIR } from "../config";
import * as schema from "./schema";

type Db = BetterSQLite3Database<typeof schema>;

// Kept on globalThis so dev reloads don't open a new connection each time.
const cache = globalThis as unknown as { roomDb?: Db };

export function getDb(): Db {
  if (cache.roomDb) return cache.roomDb;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const sqlite = new Database(path.join(DATA_DIR, "room.db"));
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  cache.roomDb = db;
  return db;
}
