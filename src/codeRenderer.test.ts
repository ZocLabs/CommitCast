import assert from "node:assert/strict";
import test from "node:test";
import { extractRelevantDiffLines } from "./codeRenderer.js";

const sampleDiff = `diff --git a/src/gitEngine.ts b/src/gitEngine.ts
index 1111111..2222222 100644
--- a/src/gitEngine.ts
+++ b/src/gitEngine.ts
@@ -1,20 +1,22 @@
 import path from "node:path";
-export async function oldContext() {
-  return "legacy";
-}
+export async function getRepoContext() {
+  const git = simpleGit();
+  const isRepo = await git.checkIsRepo();
+  if (!isRepo) {
+    throw new Error("Not a git repository.");
+  }
+  const log = await git.log({ maxCount: 1 });
+  return log.latest;
+}
 const unused = true;
`;

test("extractRelevantDiffLines prefers the changed hunk and keeps add/del kinds", () => {
  const snippet = extractRelevantDiffLines(sampleDiff);

  assert.equal(snippet.filePath, "src/gitEngine.ts");
  assert.ok(snippet.lines.length >= 10);
  assert.ok(snippet.lines.length <= 15);
  assert.ok(snippet.lines.some((line) => line.kind === "add"));
  assert.ok(snippet.lines.some((line) => line.kind === "del"));
  assert.ok(snippet.lines.some((line) => line.text.includes("getRepoContext")));
});

test("extractRelevantDiffLines caps long hunks at 15 lines", () => {
  const manyAdds = Array.from({ length: 40 }, (_, index) => `+const value${index} = ${index};`).join("\n");
  const diff = `diff --git a/src/long.ts b/src/long.ts\n+++ b/src/long.ts\n${manyAdds}`;
  const snippet = extractRelevantDiffLines(diff);

  assert.equal(snippet.filePath, "src/long.ts");
  assert.equal(snippet.lines.length, 15);
  assert.ok(snippet.lines.every((line) => line.kind === "add"));
});
