import https from "node:https";

export function makeHttpsAgent() {
  // FIXED: certificate validation enforced for all requests through this agent.
  return new https.Agent({ keepAlive: true, rejectUnauthorized: true });
}
