import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("package remains a public code-only ESM library without Pi resources or runtime dependencies", async () => {
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(packageJson.name, "@aefree/pi-capability-registry");
  assert.equal(packageJson.type, "module");
  assert.equal(packageJson.sideEffects, false);
  assert.equal("private" in packageJson, false);
  assert.equal(packageJson.publishConfig.access, "public");
  assert.equal(packageJson.version, "0.1.1");
  assert.equal("pi" in packageJson, false);
  assert.equal("dependencies" in packageJson, false);
  assert.equal("peerDependencies" in packageJson, false);
  assert.deepEqual(Object.keys(packageJson.exports), [".", "./conformance"]);

  for (const resourceDirectory of ["extensions", "skills", "prompts", "themes"]) {
    await assert.rejects(access(path.join(root, resourceDirectory)));
  }
});

test("shipped debugging maps resolve to authored source", async () => {
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.ok(packageJson.files.includes("src"));
  const dist = path.join(root, "dist");
  const maps = (await readdir(dist)).filter((file) => file.endsWith(".map"));
  assert.equal(maps.length, 4);
  for (const file of maps) {
    const map = JSON.parse(await readFile(path.join(dist, file), "utf8"));
    assert.equal(map.sourceRoot, "");
    assert.deepEqual(map.sources, [`../src/${file.startsWith("index.") ? "index" : "conformance"}.ts`]);
    for (const source of map.sources) await access(path.resolve(dist, source));
    const generated = await readFile(path.join(dist, map.file), "utf8");
    assert.ok(generated.includes(`sourceMappingURL=${file}`));
  }
});
