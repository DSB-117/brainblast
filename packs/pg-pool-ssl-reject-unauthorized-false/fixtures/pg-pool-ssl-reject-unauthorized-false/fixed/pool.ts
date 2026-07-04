import { Pool } from "pg";

export function makePool(connectionString: string, caCert: string) {
  // FIXED: certificate validation enforced; trust the provider's CA explicitly.
  return new Pool({ connectionString, ssl: { rejectUnauthorized: true, ca: caCert } });
}
