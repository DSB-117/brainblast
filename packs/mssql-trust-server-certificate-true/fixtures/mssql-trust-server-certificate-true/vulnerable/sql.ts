import sql from "mssql";

export function connectSql(user: string, password: string, server: string) {
  // VULNERABLE: options.trustServerCertificate: true — the SQL Server certificate is not validated.
  return sql.connect({
    user,
    password,
    server,
    database: "app",
    options: { encrypt: true, trustServerCertificate: true },
  });
}
