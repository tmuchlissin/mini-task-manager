import "dotenv/config";
import pg from "pg";

// Fail fast when the backend has no database connection configured.
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required in backend/.env");
}

// Reuse a small number of PostgreSQL connections across requests.
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
