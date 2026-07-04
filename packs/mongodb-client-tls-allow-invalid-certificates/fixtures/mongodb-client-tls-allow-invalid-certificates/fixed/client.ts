import { MongoClient } from "mongodb";

export function makeMongoClient(uri: string) {
  // FIXED: certificate validation enforced (the secure default, here explicit).
  return new MongoClient(uri, { tls: true, tlsAllowInvalidCertificates: false });
}
