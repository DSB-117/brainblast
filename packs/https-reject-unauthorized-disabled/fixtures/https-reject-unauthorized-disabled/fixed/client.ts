import https from "node:https";

export function fetchSecret(host: string) {
  // FIXED: certificate validation enforced (the secure default, here explicit).
  return https.request({ hostname: host, path: "/secret", rejectUnauthorized: true });
}
