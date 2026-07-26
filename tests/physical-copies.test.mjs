import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("separate physical module copies rendezvous through the global symbol and preserve stale-token safety", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "pi-capability-registry-copies-"));
  const copyA = path.join(temporaryRoot, "copy-a");
  const copyB = path.join(temporaryRoot, "copy-b");
  const registryKey = "@aefree/pi-capability-registry/test/physical-copy";
  const symbol = Symbol.for(registryKey);
  try {
    await Promise.all([mkdir(copyA), mkdir(copyB)]);
    await Promise.all([
      cp(path.join(packageRoot, "dist", "index.js"), path.join(copyA, "index.mjs")),
      cp(path.join(packageRoot, "dist", "index.js"), path.join(copyB, "index.mjs")),
    ]);
    const [moduleA, moduleB] = await Promise.all([
      import(pathToFileURL(path.join(copyA, "index.mjs")).href),
      import(pathToFileURL(path.join(copyB, "index.mjs")).href),
    ]);
    assert.notEqual(moduleA.createCapabilityRegistry, moduleB.createCapabilityRegistry);

    const options = { registryKey, contractVersion: 1 };
    const registryA = moduleA.createCapabilityRegistry(options);
    const registryB = moduleB.createCapabilityRegistry(options);
    const scopeA = {};
    const scopeB = {};
    const makeRecord = (marker, packageRoot = "/provider") => ({
      contractVersion: 1,
      id: "physical-provider",
      owner: { packageName: "fixture-provider", packageRoot },
      nested: { marker },
    });

    const oldToken = registryA.register(scopeA, makeRecord(1));
    assert.equal(registryB.snapshot(scopeA)[0].nested.marker, 1);
    assert.equal(registryB.snapshot(scopeB).length, 0);

    const replacementToken = registryB.register(scopeA, makeRecord(2));
    assert.equal(registryA.snapshot(scopeA).length, 1);
    assert.equal(registryA.snapshot(scopeA)[0].nested.marker, 2);
    assert.equal(registryA.unregister(oldToken), false);
    let conflict;
    try {
      registryA.register(scopeA, makeRecord(3, "/other-owner"));
    } catch (error) {
      conflict = error;
    }
    assert.equal(
      moduleB.isRegistryError(conflict, "PROVIDER_ID_CONFLICT"),
      true,
      "errors are structurally recognizable across copies",
    );
    assert.equal(registryA.snapshot(scopeA)[0].nested.marker, 2);
    assert.equal(registryA.unregister(replacementToken), true);
    assert.equal(registryB.unregister(replacementToken), false);

    const root = globalThis[symbol];
    assert.equal(root.protocolVersion, 1);
    assert.equal(root.versions.get(1).scopes instanceof WeakMap, true);
  } finally {
    delete globalThis[symbol];
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
