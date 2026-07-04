import { connect } from "nats";

export function connectNats(servers: string) {
  // VULNERABLE: tls.rejectUnauthorized: false — the NATS server certificate is not validated.
  return connect({ servers, tls: { rejectUnauthorized: false } });
}
