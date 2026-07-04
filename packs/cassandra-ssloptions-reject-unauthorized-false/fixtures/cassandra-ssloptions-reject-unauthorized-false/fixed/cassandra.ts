import { Client } from "cassandra-driver";

export function makeClient(contactPoints: string[], ca: string) {
  // FIXED: certificate validation enforced; trust the cluster CA explicitly.
  return new Client({ contactPoints, localDataCenter: "dc1", sslOptions: { rejectUnauthorized: true, ca } });
}
