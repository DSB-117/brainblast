// FIXED: request input is never passed to the shell command; the directory
// listed is fixed.
import { execSync } from "child_process";

export function listFilesHandler(req: any): string {
  const filename = req.query.filename;
  return execSync("ls -la").toString() + filename;
}
