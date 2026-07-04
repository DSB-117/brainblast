import AWS from "aws-sdk";

export function uploadUserFile(s3: AWS.S3, key: string, body: Buffer) {
  // FIXED: objects are private; serve them via pre-signed URLs when needed.
  return s3.putObject({ Bucket: "user-uploads", Key: key, Body: body, ACL: "private" }).promise();
}
