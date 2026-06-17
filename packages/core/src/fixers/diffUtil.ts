import type { Node } from "ts-morph";

// Build a unified-diff hunk that replaces the source range covered by `node`
// with `replacement`. Handles single- and multi-line node ranges. Paths are
// emitted as absolute filesystem paths (a/<path> -> b/<path>) so an agent can
// locate the file regardless of its own working directory.
export function buildDiff(node: Node, replacement: string): string {
  const sf = node.getSourceFile();
  const filePath = sf.getFilePath();
  const fullText = sf.getFullText();

  const start = node.getStart();
  const end = node.getEnd();
  const startPos = sf.getLineAndColumnAtPos(start);
  const endPos = sf.getLineAndColumnAtPos(end);

  const lines = fullText.split("\n");
  const oldMiddle = lines.slice(startPos.line - 1, endPos.line);

  const oldFirst = oldMiddle[0]!.slice(0, startPos.column - 1);
  const oldLast = oldMiddle[oldMiddle.length - 1]!.slice(endPos.column - 1);
  const newMiddle = (oldFirst + replacement + oldLast).split("\n");

  const removed = oldMiddle.map((l) => `-${l}`);
  const added = newMiddle.map((l) => `+${l}`);

  const hunkHeader = `@@ -${startPos.line},${oldMiddle.length} +${startPos.line},${newMiddle.length} @@`;

  return [`--- a${filePath}`, `+++ b${filePath}`, hunkHeader, ...removed, ...added].join("\n");
}
