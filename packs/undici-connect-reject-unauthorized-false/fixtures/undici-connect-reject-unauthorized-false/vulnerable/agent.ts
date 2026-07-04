import { Agent } from "undici";

export function makeAgent() {
  // VULNERABLE: connect.rejectUnauthorized: false disables TLS validation for every request through this agent.
  return new Agent({ connect: { rejectUnauthorized: false }, keepAliveTimeout: 10000 });
}
