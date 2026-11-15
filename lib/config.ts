import path from "node:path";

/** Everything personal lives here: the database and every photo. Back this folder up. */
export const DATA_DIR = path.resolve(
  /* turbopackIgnore: true */ process.env.DATA_DIR ?? "data",
);
