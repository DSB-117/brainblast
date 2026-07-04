import mongoose from "mongoose";

export function connectDatabase(uri: string) {
  // FIXED: certificate validation enforced (the secure default, here explicit).
  return mongoose.connect(uri, {
    tls: true,
    tlsAllowInvalidCertificates: false,
  });
}
