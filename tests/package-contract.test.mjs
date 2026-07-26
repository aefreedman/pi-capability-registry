import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("package remains a code-only ESM library without Pi resources or runtime dependencies", async () => {
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(packageJson.name, "@aefree/pi-capability-registry");
  assert.equal(packageJson.type, "module");
  assert.equal(packageJson.sideEffects, false);
  assert.equal(packageJson.private, true);
  assert.equal(packageJson.version, "0.1.0");
  assert.equal("pi" in packageJson, false);
  assert.equal("dependencies" in packageJson, false);
  assert.equal("peerDependencies" in packageJson, false);
  assert.deepEqual(Object.keys(packageJson.exports), [".", "./conformance"]);

  for (const resourceDirectory of ["extensions", "skills", "prompts", "themes"]) {
    await assert.rejects(access(path.join(root, resourceDirectory)));
  }
});
