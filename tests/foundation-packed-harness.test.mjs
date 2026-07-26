import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const registryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(registryRoot, "..");
const packageNames = ["pi-capability-registry", "pi-repo-search", "pi-project-artifacts", "pi-workflow"];
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

test("neutral packed consumer composes all Wave 0 packages and diagnostics", { timeout: 180_000 }, async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "pi-wave0-packed-consumer-"));
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
    const installedManifest = JSON.parse(await readFile(path.join(consumer, "node_modules", "@aefree", "pi-repo-search", "package.json"), "utf8"));
    assert.equal(JSON.stringify(installedManifest).includes("file:../"), false);

    const imports = [
      "@aefree/pi-capability-registry",
      "@aefree/pi-capability-registry/conformance",
      "@aefree/pi-repo-search",
      "@aefree/pi-repo-search/contracts",
      "@aefree/pi-repo-search/contracts/v1",
      "@aefree/pi-repo-search/contracts/v1/conformance",
      "@aefree/pi-project-artifacts",
      "@aefree/pi-project-artifacts/contracts",
      "@aefree/pi-project-artifacts/contracts/v1",
      "@aefree/pi-project-artifacts/contracts/v1/conformance",
      "@aefree/pi-workflow",
      "@aefree/pi-workflow/contracts",
      "@aefree/pi-workflow/contracts/v1",
      "@aefree/pi-workflow/contracts/v1/arbitration",
      "@aefree/pi-workflow/contracts/v1/git-root",
      "@aefree/pi-workflow/contracts/v1/conformance",
    ];
    await writeFile(path.join(consumer, "imports.mjs"), `
      const imports = ${JSON.stringify(imports)};
      const before = new Set(Reflect.ownKeys(globalThis));
      for (const specifier of imports) await import(specifier);
      const added = Reflect.ownKeys(globalThis).filter((key) => !before.has(key));
      if (added.length) throw new Error("import side effects: " + added.map(String).join(","));
      console.log(JSON.stringify({ imported: imports.length }));
    `);
    assert.deepEqual(JSON.parse(run(process.execPath, ["imports.mjs"], consumer)), { imported: imports.length });

    const copies = [];
    for (const copyName of ["copy-a", "copy-b"]) {
      const copy = path.join(temporaryRoot, copyName);
      await mkdir(copy);
      installTarballs(copy, [tarballs.get("pi-capability-registry"), tarballs.get("pi-repo-search")]);
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
        load(copyA, "node_modules/@aefree/pi-repo-search/dist/contracts/v1/index.js"),
        load(copyB, "node_modules/@aefree/pi-repo-search/dist/contracts/v1/index.js"),
        load(copyA, "node_modules/@aefree/pi-capability-registry/dist/index.js"),
      ]);
      assert.notEqual(contractsA.createRepositoryPolicyRegistryV1, contractsB.createRepositoryPolicyRegistryV1);
      const owner = (name, root) => ({ packageName: name, packageVersion: "1.0.0", packageRoot: root, registeredBy: "extensions/provider.ts" });
      const policy = { contractVersion: 1, id: "fixture.policy", kind: "repository-search-policy", owner: owner("@fixture/policy", "/private/a"), async evaluate() { return { outcome: "not_applicable" }; } };
      const key = contractsA.REPOSITORY_POLICY_REGISTRY_KEY_V1;

      const providerFirstScope = {};
      contractsA.createRepositoryPolicyRegistryV1().register(providerFirstScope, policy);
      assert.equal(contractsB.resolveRepositoryPoliciesV1(providerFirstScope).outcome, "available");
      delete globalThis[Symbol.for(key)];

      const consumerFirstScope = {};
      const consumerFirst = contractsB.createRepositoryPolicyRegistryV1();
      assert.equal(contractsB.resolveRepositoryPoliciesV1(consumerFirstScope, consumerFirst).code, "missing_registration");
      contractsA.createRepositoryPolicyRegistryV1().register(consumerFirstScope, policy);
      assert.equal(contractsB.resolveRepositoryPoliciesV1(consumerFirstScope, consumerFirst).outcome, "available");
      delete globalThis[Symbol.for(key)];

      const incompatibleScope = {};
      const v1 = contractsB.createRepositoryPolicyRegistryV1();
      registryA.createCapabilityRegistry({ registryKey: key, contractVersion: 2 }).register(incompatibleScope, {
        contractVersion: 2,
        id: "future.policy",
        owner: owner("@fixture/future", "/private/future"),
        callback() { throw new Error("must not enter catalog"); },
      });
      const incompatible = contractsB.resolveRepositoryPoliciesV1(incompatibleScope, v1);
      assert.equal(incompatible.code, "incompatible_contract");
      assert.deepEqual(incompatible.providerIds, ["future.policy"]);
      assert.equal(Object.isFrozen(incompatible.catalog.versions[0].registrations[0]), true);
      assert.equal(JSON.stringify(incompatible).includes("packageRoot"), false);
      assert.equal(JSON.stringify(incompatible).includes("callback"), false);
      delete globalThis[Symbol.for(key)];

      const serviceScope = {};
      const services = contractsA.createRepoSearchServiceRegistryV1();
      const makeService = (id) => ({
        contractVersion: 1, id, kind: "repo-search-service", owner: owner("@fixture/" + id, "/private/" + id),
        async search() { throw new Error("not invoked"); },
      });
      services.register(serviceScope, makeService("service.a"));
      services.register(serviceScope, makeService("service.b"));
      const duplicate = contractsB.resolveRepoSearchServiceV1(serviceScope);
      assert.equal(duplicate.code, "duplicate_registration");
      assert.deepEqual(duplicate.providerIds, ["service.a", "service.b"]);
      delete globalThis[Symbol.for(contractsA.REPO_SEARCH_SERVICE_REGISTRY_KEY_V1)];
      console.log(JSON.stringify({ physicalCopies: true, loadOrders: 2, diagnostics: ["missing", "incompatible", "duplicate"] }));
    `);
    const result = JSON.parse(run(process.execPath, [harnessPath, ...copies], temporaryRoot));
    assert.deepEqual(result, { physicalCopies: true, loadOrders: 2, diagnostics: ["missing", "incompatible", "duplicate"] });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
