import https from "node:https";

export function fetchSecret(host: string) {
  // VULNERABLE: TLS cert validation is OFF — the connection can be silently MITM'd.
  return https.request({ hostname: host, path: "/secret", rejectUnauthorized: false });
}
