import mongoose from "mongoose";

export function connectDatabase(uri: string) {
  // VULNERABLE: the MongoDB server's TLS certificate is not validated — the connection can be MITM'd.
  return mongoose.connect(uri, {
    tls: true,
    tlsAllowInvalidCertificates: true,
  });
}
