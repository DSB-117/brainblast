import { connect } from "nats";

export function connectNats(servers: string, ca: string) {
  // FIXED: certificate validation enforced; trust the server CA explicitly.
  return connect({ servers, tls: { rejectUnauthorized: true, ca } });
}
