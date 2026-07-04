import { DataSource } from "typeorm";

export function makeDataSource(url: string) {
  // VULNERABLE: ssl.rejectUnauthorized: false — the DB certificate is not validated.
  return new DataSource({ type: "postgres", url, ssl: { rejectUnauthorized: false } });
}
