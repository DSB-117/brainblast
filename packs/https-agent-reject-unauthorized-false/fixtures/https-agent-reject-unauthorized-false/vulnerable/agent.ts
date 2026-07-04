import https from "node:https";

export function makeHttpsAgent() {
  // VULNERABLE: rejectUnauthorized: false disables TLS validation for every request through this agent.
  return new https.Agent({ keepAlive: true, rejectUnauthorized: false });
}
