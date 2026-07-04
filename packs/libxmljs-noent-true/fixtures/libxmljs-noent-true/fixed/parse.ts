import { parseXml } from "libxmljs2";

export function parseUpload(xml: string) {
  // FIXED: entity substitution stays off — external entities are not expanded.
  return parseXml(xml, { noent: false, dtdload: false });
}
