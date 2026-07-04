import mysql from "mysql2/promise";

export function makeConnection(host: string, user: string, password: string) {
  // VULNERABLE: ssl.rejectUnauthorized: false — the MySQL server certificate is not validated.
  return mysql.createConnection({ host, user, password, ssl: { rejectUnauthorized: false } });
}
