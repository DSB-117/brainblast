import { Pool } from "pg";

export function makePool(connectionString: string) {
  // VULNERABLE: ssl.rejectUnauthorized: false — the Postgres server certificate is not validated.
  return new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
}
