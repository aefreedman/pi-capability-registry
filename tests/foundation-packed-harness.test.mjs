import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const registryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(registryRoot, "..");
// Only package code with a current build and public exports belongs in this packed contract.
const packageNames = ["pi-capability-registry", "pi-package-references", "pi-project-artifacts"];
const npmCli = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function runNpm(args, cwd) {
  return run(process.execPath, [npmCli, ...args], cwd);
}

function installTarballs(target, tarballs) {
  runNpm(["init", "-y"], target);
  runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund", ...tarballs], target);
}

test("neutral packed consumer composes current registry and contract packages", { timeout: 180_000 }, async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "pi-foundation-packed-consumer-"));
  try {
    const tarballRoot = path.join(temporaryRoot, "tarballs");
    await mkdir(tarballRoot);
    const tarballs = new Map();
    for (const packageDirectory of packageNames) {
      const packageRoot = path.join(workspaceRoot, packageDirectory);
      runNpm(["run", "build"], packageRoot);
      const packed = JSON.parse(runNpm(["pack", "--json", "--ignore-scripts", "--pack-destination", tarballRoot], packageRoot));
      assert.equal(packed.length, 1);
      tarballs.set(packageDirectory, path.join(tarballRoot, packed[0].filename));
    }

    const consumer = path.join(temporaryRoot, "consumer");
    await mkdir(consumer);
    installTarballs(consumer, packageNames.map((name) => tarballs.get(name)));
    for (const packageDirectory of packageNames) {
      const manifest = JSON.parse(await readFile(path.join(consumer, "node_modules", "@aefree", packageDirectory, "package.json"), "utf8"));
      assert.equal(JSON.stringify(manifest).includes("file:../"), false);
    }

    const imports = [
      "@aefree/pi-capability-registry",
      "@aefree/pi-capability-registry/conformance",
      "@aefree/pi-package-references",
      "@aefree/pi-package-references/contracts/v1",
      "@aefree/pi-package-references/runtime/v1",
      "@aefree/pi-project-artifacts",
      "@aefree/pi-project-artifacts/contracts",
      "@aefree/pi-project-artifacts/contracts/v1",
      "@aefree/pi-project-artifacts/contracts/v1/conformance",
      "@aefree/pi-project-artifacts/core",
    ];
    await writeFile(path.join(consumer, "imports.mjs"), `
      const imports = ${JSON.stringify(imports)};
      const before = new Set(Reflect.ownKeys(globalThis));
      for (const specifier of imports) await import(specifier);
      const added = Reflect.ownKeys(globalThis).filter((key) => !before.has(key));
      const expected = Symbol.for("@aefree/pi-package-references/owners/v1");
      if (added.length !== 1 || added[0] !== expected) {
        throw new Error("unexpected import side effects: " + added.map(String).join(","));
      }
      console.log(JSON.stringify({ imported: imports.length }));
    `);
    assert.deepEqual(JSON.parse(run(process.execPath, ["imports.mjs"], consumer)), { imported: imports.length });

    const copies = [];
    for (const copyName of ["copy-a", "copy-b"]) {
      const copy = path.join(temporaryRoot, copyName);
      await mkdir(copy);
      installTarballs(copy, [tarballs.get("pi-capability-registry"), tarballs.get("pi-project-artifacts")]);
      copies.push(copy);
    }

    const harnessPath = path.join(temporaryRoot, "rendezvous.mjs");
    await writeFile(harnessPath, `
      import assert from "node:assert/strict";
      import path from "node:path";
      import { pathToFileURL } from "node:url";
      const [copyA, copyB] = process.argv.slice(2);
      const load = (root, relative) => import(pathToFileURL(path.join(root, relative)).href);
      const [contractsA, contractsB, registryA] = await Promise.all([
        load(copyA, "node_modules/@aefree/pi-project-artifacts/dist/contracts/v1/index.js"),
        load(copyB, "node_modules/@aefree/pi-project-artifacts/dist/contracts/v1/index.js"),
        load(copyA, "node_modules/@aefree/pi-capability-registry/dist/index.js"),
      ]);
      assert.notEqual(contractsA.createArtifactSearchServiceRegistryV1, contractsB.createArtifactSearchServiceRegistryV1);
      const owner = (id) => ({ packageName: "@fixture/" + id, packageVersion: "1.0.0", packageRoot: "/private/" + id, registeredBy: "extensions/provider.ts" });
      const service = (id) => ({ contractVersion: 1, id, kind: "artifact-search-service", owner: owner(id), async search() { throw new Error("not invoked"); } });
      const key = contractsA.ARTIFACT_SEARCH_SERVICE_REGISTRY_KEY_V1;

      const providerFirstScope = {};
      contractsA.createArtifactSearchServiceRegistryV1().register(providerFirstScope, service("service.a"));
      assert.equal(contractsB.resolveArtifactSearchServiceV1(providerFirstScope).outcome, "available");
      delete globalThis[Symbol.for(key)];

      const consumerFirstScope = {};
      const consumerFirst = contractsB.createArtifactSearchServiceRegistryV1();
      assert.equal(contractsB.resolveArtifactSearchServiceV1(consumerFirstScope, consumerFirst).code, "missing_registration");
      contractsA.createArtifactSearchServiceRegistryV1().register(consumerFirstScope, service("service.a"));
      assert.equal(contractsB.resolveArtifactSearchServiceV1(consumerFirstScope, consumerFirst).outcome, "available");
      delete globalThis[Symbol.for(key)];

      const incompatibleScope = {};
      const v1 = contractsB.createArtifactSearchServiceRegistryV1();
      registryA.createCapabilityRegistry({ registryKey: key, contractVersion: 2 }).register(incompatibleScope, {
        contractVersion: 2, id: "future.service", owner: owner("future"),
        callback() { throw new Error("must not enter catalog"); },
      });
      const incompatible = contractsB.resolveArtifactSearchServiceV1(incompatibleScope, v1);
      assert.equal(incompatible.code, "incompatible_contract");
      assert.deepEqual(incompatible.providerIds, ["future.service"]);
      assert.equal(Object.isFrozen(incompatible.catalog.versions[0].registrations[0]), true);
      assert.equal(JSON.stringify(incompatible).includes("packageRoot"), false);
      assert.equal(JSON.stringify(incompatible).includes("callback"), false);
      delete globalThis[Symbol.for(key)];

      const duplicateScope = {};
      const services = contractsA.createArtifactSearchServiceRegistryV1();
      services.register(duplicateScope, service("service.a"));
      services.register(duplicateScope, service("service.b"));
      const duplicate = contractsB.resolveArtifactSearchServiceV1(duplicateScope);
      assert.equal(duplicate.code, "duplicate_registration");
      assert.deepEqual(duplicate.providerIds, ["service.a", "service.b"]);
      delete globalThis[Symbol.for(key)];
      console.log(JSON.stringify({ physicalCopies: true, loadOrders: 2, diagnostics: ["missing", "incompatible", "duplicate"] }));
    `);
    const result = JSON.parse(run(process.execPath, [harnessPath, ...copies], temporaryRoot));
    assert.deepEqual(result, { physicalCopies: true, loadOrders: 2, diagnostics: ["missing", "incompatible", "duplicate"] });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
