import knex from "knex";

export function makeDb(connectionString: string, ca: string) {
  // FIXED: certificate validation enforced; trust the provider's CA explicitly.
  return knex({ client: "pg", connection: { connectionString, ssl: { rejectUnauthorized: true, ca } } });
}
