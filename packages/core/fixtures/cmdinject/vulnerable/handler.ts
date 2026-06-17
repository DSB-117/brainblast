// VULNERABLE: untrusted query input is interpolated into a shell command.
import { execSync } from "child_process";

export function listFilesHandler(req: any): string {
  const filename = req.query.filename;
  return execSync(`ls ${filename}`).toString();
}
