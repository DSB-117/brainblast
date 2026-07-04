import { parseXml } from "libxmljs2";

export function parseUpload(xml: string) {
  // VULNERABLE: noent: true expands external entities — untrusted XML can read local files (XXE).
  return parseXml(xml, { noent: true, dtdload: true });
}
