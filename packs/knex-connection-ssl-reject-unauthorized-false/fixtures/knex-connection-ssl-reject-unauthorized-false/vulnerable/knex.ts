import knex from "knex";

export function makeDb(connectionString: string) {
  // VULNERABLE: connection.ssl.rejectUnauthorized: false — the DB certificate is not validated.
  return knex({ client: "pg", connection: { connectionString, ssl: { rejectUnauthorized: false } } });
}
