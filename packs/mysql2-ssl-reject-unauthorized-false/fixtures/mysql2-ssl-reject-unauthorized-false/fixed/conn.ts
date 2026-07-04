import mysql from "mysql2/promise";

export function makeConnection(host: string, user: string, password: string, ca: string) {
  // FIXED: certificate validation enforced; trust the provider's CA explicitly.
  return mysql.createConnection({ host, user, password, ssl: { rejectUnauthorized: true, ca } });
}
