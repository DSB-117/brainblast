import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

export function uploadUserFile(s3: S3Client, key: string, body: Uint8Array) {
  // FIXED: objects are private; serve them via pre-signed URLs when needed.
  const cmd = new PutObjectCommand({ Bucket: "user-uploads", Key: key, Body: body, ACL: "private" });
  return s3.send(cmd);
}
