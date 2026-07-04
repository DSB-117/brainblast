import AWS from "aws-sdk";

export function uploadUserFile(s3: AWS.S3, key: string, body: Buffer) {
  // VULNERABLE: public-read makes every uploaded object readable by anyone on the internet.
  return s3.putObject({ Bucket: "user-uploads", Key: key, Body: body, ACL: "public-read" }).promise();
}
