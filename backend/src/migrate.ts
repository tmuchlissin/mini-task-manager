import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";

try {
  // Resolve schema.sql from this module instead of depending on the shell cwd.
  const schema = await readFile(
    fileURLToPath(new URL("../schema.sql", import.meta.url)),
    "utf8",
  );
  // The schema uses idempotent statements and can be run repeatedly.
  await pool.query(schema);
  console.log("Database schema ready");
} catch (error) {
  console.error("Database migration failed", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
