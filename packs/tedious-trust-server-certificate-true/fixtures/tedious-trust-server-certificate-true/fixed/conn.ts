import { Connection } from "tedious";

export function makeConnection(server: string, userName: string, password: string) {
  // FIXED: certificate validation enforced on the SQL Server connection.
  return new Connection({
    server,
    authentication: { type: "default", options: { userName, password } },
    options: { encrypt: true, trustServerCertificate: false },
  });
}
