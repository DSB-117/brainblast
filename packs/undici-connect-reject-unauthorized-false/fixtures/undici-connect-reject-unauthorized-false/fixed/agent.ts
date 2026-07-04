import { Agent } from "undici";

export function makeAgent(ca: string) {
  // FIXED: certificate validation enforced; trust a private CA explicitly if needed.
  return new Agent({ connect: { rejectUnauthorized: true, ca }, keepAliveTimeout: 10000 });
}
