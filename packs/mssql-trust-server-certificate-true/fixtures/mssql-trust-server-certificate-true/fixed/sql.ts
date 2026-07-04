import sql from "mssql";

export function connectSql(user: string, password: string, server: string) {
  // FIXED: certificate validation enforced on the SQL Server connection.
  return sql.connect({
    user,
    password,
    server,
    database: "app",
    options: { encrypt: true, trustServerCertificate: false },
  });
}
