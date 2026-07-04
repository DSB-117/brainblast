import { Client } from "cassandra-driver";

export function makeClient(contactPoints: string[]) {
  // VULNERABLE: sslOptions.rejectUnauthorized: false — the Cassandra node certificate is not validated.
  return new Client({ contactPoints, localDataCenter: "dc1", sslOptions: { rejectUnauthorized: false } });
}
