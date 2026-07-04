import { DataSource } from "typeorm";

export function makeDataSource(url: string, ca: string) {
  // FIXED: certificate validation enforced; trust the provider's CA explicitly.
  return new DataSource({ type: "postgres", url, ssl: { rejectUnauthorized: true, ca } });
}
