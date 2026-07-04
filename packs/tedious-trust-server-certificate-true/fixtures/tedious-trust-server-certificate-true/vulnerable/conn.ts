import { Connection } from "tedious";

export function makeConnection(server: string, userName: string, password: string) {
  // VULNERABLE: options.trustServerCertificate: true — the SQL Server certificate is not validated.
  return new Connection({
    server,
    authentication: { type: "default", options: { userName, password } },
    options: { encrypt: true, trustServerCertificate: true },
  });
}
