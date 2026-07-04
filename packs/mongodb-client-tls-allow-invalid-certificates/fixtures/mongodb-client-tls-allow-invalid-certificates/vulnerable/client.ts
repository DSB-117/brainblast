import { MongoClient } from "mongodb";

export function makeMongoClient(uri: string) {
  // VULNERABLE: the MongoDB server's TLS certificate is not validated — the connection can be MITM'd.
  return new MongoClient(uri, { tls: true, tlsAllowInvalidCertificates: true });
}
