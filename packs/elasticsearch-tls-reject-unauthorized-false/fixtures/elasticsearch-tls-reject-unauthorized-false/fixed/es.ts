import { Client } from "@elastic/elasticsearch";

export function makeEsClient(node: string, apiKey: string, ca: string) {
  // FIXED: certificate validation enforced; trust the cluster CA explicitly.
  return new Client({ node, auth: { apiKey }, tls: { rejectUnauthorized: true, ca } });
}
