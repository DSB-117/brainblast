import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

export function uploadUserFile(s3: S3Client, key: string, body: Uint8Array) {
  // VULNERABLE: public-read makes every uploaded object readable by anyone on the internet.
  const cmd = new PutObjectCommand({ Bucket: "user-uploads", Key: key, Body: body, ACL: "public-read" });
  return s3.send(cmd);
}
