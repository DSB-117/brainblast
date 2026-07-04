import { Client } from "@elastic/elasticsearch";

export function makeEsClient(node: string, apiKey: string) {
  // VULNERABLE: tls.rejectUnauthorized: false — the cluster certificate is not validated.
  return new Client({ node, auth: { apiKey }, tls: { rejectUnauthorized: false } });
}
