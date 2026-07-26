import assert from "node:assert/strict";
import test from "node:test";
import {
  RegistryError,
  assertRuntimeScope,
  createCapabilityRegistry,
  isRegistryError,
  validateBaseRecord,
} from "../dist/index.js";
import { assertRegistryConformance } from "../dist/conformance.js";

const keys = new Set();
function key(name) {
  const value = `@aefree/pi-capability-registry/test/${name}`;
  keys.add(value);
  return value;
}

test.afterEach(() => {
  for (const value of keys) delete globalThis[Symbol.for(value)];
  keys.clear();
});

function record({ version = 1, id = "provider", packageName = "fixture-a", packageRoot = "/a", registeredBy = "extensions/provider.ts", marker = 1 } = {}) {
  return {
    contractVersion: version,
    id,
    kind: "fixture",
    owner: {
      packageName,
      packageVersion: "1.0.0",
      packageRoot,
      registeredBy,
      metadata: { channel: "test", labels: ["one"] },
    },
    configuration: { nested: { marker } },
    capability: (executionContext) => ({ marker, cwd: executionContext.cwd }),
  };
}

function registry(name, version = 1, compatibleVersions, validate) {
  return createCapabilityRegistry({
    registryKey: key(name),
    contractVersion: version,
    ...(compatibleVersions === undefined ? {} : { compatibleVersions }),
    validate: validate ?? ((candidate) => {
      if (candidate.kind !== "fixture") throw new Error("kind must be fixture");
      if (typeof candidate.capability !== "function") return false;
    }),
  });
}

test("registers, replaces atomically, diagnoses conflicts, and cleans up idempotently", () => {
  const first = registry("lifecycle");
  const second = registry("lifecycle");
  const scope = {};

  const oldToken = first.register(scope, record({ marker: 1 }));
  assert.equal(second.snapshot(scope)[0].configuration.nested.marker, 1);

  const currentToken = second.register(scope, record({ marker: 2 }));
  assert.equal(currentToken.nonce, oldToken.nonce + 1);
  assert.equal(first.snapshot(scope).length, 1);
  assert.equal(first.snapshot(scope)[0].configuration.nested.marker, 2);
  assert.equal(first.unregister(oldToken), false);

  assert.throws(
    () => first.register(scope, record({ packageName: "fixture-b", packageRoot: "/b", marker: 3 })),
    (error) => {
      assert.equal(isRegistryError(error, "PROVIDER_ID_CONFLICT"), true);
      assert.equal(error.details.id, "provider");
      assert.equal(error.details.existingOwner.packageName, "fixture-a");
      assert.equal(error.details.attemptedOwner.packageName, "fixture-b");
      return true;
    },
  );
  assert.equal(first.snapshot(scope)[0].configuration.nested.marker, 2);

  assert.equal(first.unregister(currentToken), true);
  assert.equal(first.unregister(currentToken), false);
  assert.equal(second.unregister(undefined), false);
  assert.equal(second.snapshot(scope).length, 0);
});

test("validation and structural cloning happen before replacement mutation", () => {
  const target = registry("atomic-validation");
  const scope = {};
  target.register(scope, record({ marker: 1 }));

  assert.throws(
    () => target.register(scope, { ...record({ marker: 2 }), kind: "wrong" }),
    (error) => isRegistryError(error, "INVALID_RECORD") && /kind must be fixture/.test(error.message),
  );
  const cyclic = record({ marker: 3 });
  cyclic.configuration.nested.loop = cyclic.configuration;
  assert.throws(
    () => target.register(scope, cyclic),
    (error) => isRegistryError(error, "INVALID_RECORD") && /cycle/.test(error.message),
  );
  assert.equal(target.snapshot(scope)[0].configuration.nested.marker, 1);
});

test("snapshots are detached and deeply frozen for structural data while callbacks remain callable", () => {
  const target = registry("snapshot");
  const scope = {};
  const input = record({ marker: 7 });
  const token = target.register(scope, input);
  input.owner.metadata.channel = "mutated";
  input.owner.metadata.labels.push("two");
  input.configuration.nested.marker = 99;

  const snapshot = target.snapshot(scope);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot[0]), true);
  assert.equal(Object.isFrozen(snapshot[0].owner), true);
  assert.equal(Object.isFrozen(snapshot[0].owner.metadata), true);
  assert.equal(Object.isFrozen(snapshot[0].owner.metadata.labels), true);
  assert.equal(Object.isFrozen(snapshot[0].configuration.nested), true);
  assert.deepEqual(snapshot[0].owner.metadata, { channel: "test", labels: ["one"] });
  assert.equal(snapshot[0].configuration.nested.marker, 7);
  assert.deepEqual(snapshot[0].capability({ cwd: "/current/execution" }), {
    marker: 7,
    cwd: "/current/execution",
  });
  assert.throws(() => snapshot.push("nope"), TypeError);
  assert.throws(() => { snapshot[0].configuration.nested.marker = 100; }, TypeError);
  assert.equal(Object.isFrozen(token), true);
});

test("runtime scopes are mandatory and isolated even when an unrelated event bus is shared", () => {
  const target = registry("scope-isolation");
  const sharedEventBus = {};
  const scopeA = { sharedEventBus };
  const scopeB = { sharedEventBus };
  target.register(scopeA, record({ marker: 1 }));
  target.register(scopeB, record({ marker: 2 }));

  assert.equal(target.snapshot(scopeA)[0].configuration.nested.marker, 1);
  assert.equal(target.snapshot(scopeB)[0].configuration.nested.marker, 2);
  assert.throws(() => target.snapshot(null), (error) => isRegistryError(error, "INVALID_SCOPE"));
  assert.throws(() => target.register("scope", record()), (error) => isRegistryError(error, "INVALID_SCOPE"));
  assert.throws(() => assertRuntimeScope(1), RegistryError);
});

test("version catalogs distinguish missing, compatible, and incompatible registrations", () => {
  const registryKey = key("catalog");
  const v1 = createCapabilityRegistry({ registryKey, contractVersion: 1, compatibleVersions: [1, 2] });
  const v2 = createCapabilityRegistry({ registryKey, contractVersion: 2 });
  const v3 = createCapabilityRegistry({ registryKey, contractVersion: 3 });
  const scope = {};

  assert.deepEqual(v1.catalog(scope), {
    registryKey,
    requestedVersion: 1,
    compatibleVersions: [1, 2],
    status: "missing",
    versions: [],
  });

  const token3 = v3.register(scope, record({ version: 3, marker: 3 }));
  assert.equal(v1.catalog(scope).status, "incompatible");
  assert.deepEqual(v1.catalog(scope).versions, [{
    version: 3,
    count: 1,
    compatible: false,
    registrations: [{
      id: "provider",
      packageName: "fixture-a",
      packageVersion: "1.0.0",
      contractVersion: 3,
      registeredBy: "extensions/provider.ts",
    }],
  }]);
  const incompatibleCatalog = v1.catalog(scope);
  assert.equal(Object.isFrozen(incompatibleCatalog), true);
  assert.equal(Object.isFrozen(incompatibleCatalog.versions), true);
  assert.equal(Object.isFrozen(incompatibleCatalog.versions[0].registrations), true);
  assert.equal(Object.isFrozen(incompatibleCatalog.versions[0].registrations[0]), true);
  assert.equal(JSON.stringify(incompatibleCatalog).includes("packageRoot"), false);
  assert.deepEqual(Object.keys(incompatibleCatalog.versions[0].registrations[0]), [
    "id", "packageName", "packageVersion", "contractVersion", "registeredBy",
  ]);
  assert.deepEqual(v1.snapshotCompatible(scope), []);

  const token2 = v2.register(scope, record({ version: 2, marker: 2 }));
  assert.equal(v1.catalog(scope).status, "compatible");
  assert.deepEqual(v1.catalog(scope).versions.map(({ version, count, compatible }) => ({ version, count, compatible })), [
    { version: 2, count: 1, compatible: true },
    { version: 3, count: 1, compatible: false },
  ]);
  assert.equal(v1.snapshot(scope).length, 0);
  assert.equal(v1.snapshotCompatible(scope)[0].configuration.nested.marker, 2);
  assert.equal(v2.unregister(token3), false, "tokens cannot cross contract versions");
  assert.equal(v2.unregister(token2), true);
  assert.equal(v1.catalog(scope).status, "incompatible");
  assert.equal(v3.unregister(token3), true);
  assert.equal(v1.catalog(scope).status, "missing");
});

test("catalog omits unsafe registeredBy provenance and all private owner fields", () => {
  const target = registry("safe-catalog", 1);
  const scope = {};
  target.register(scope, record({ registeredBy: "C:\\private\\extension.ts" }));
  const registration = target.catalog(scope).versions[0].registrations[0];
  assert.deepEqual(registration, {
    id: "provider",
    packageName: "fixture-a",
    packageVersion: "1.0.0",
    contractVersion: 1,
  });
  assert.equal("packageRoot" in registration, false);
  assert.equal("metadata" in registration, false);
});

test("rejects incompatible global roots and version states without overwriting them", () => {
  const badRootKey = key("bad-root");
  const badRoot = { contractVersion: 99, scopes: new WeakMap() };
  globalThis[Symbol.for(badRootKey)] = badRoot;
  assert.throws(
    () => createCapabilityRegistry({ registryKey: badRootKey, contractVersion: 1 }),
    (error) => isRegistryError(error, "REGISTRY_ROOT_INCOMPATIBLE"),
  );
  assert.equal(globalThis[Symbol.for(badRootKey)], badRoot);

  const badVersionKey = key("bad-version");
  createCapabilityRegistry({ registryKey: badVersionKey, contractVersion: 1 });
  globalThis[Symbol.for(badVersionKey)].versions.set(2, { version: 2, scopes: new Map() });
  assert.throws(
    () => createCapabilityRegistry({ registryKey: badVersionKey, contractVersion: 2 }),
    (error) => isRegistryError(error, "VERSION_STATE_INCOMPATIBLE"),
  );
});

test("base validation rejects malformed records and custom validators can return false", () => {
  assert.throws(() => validateBaseRecord({}, 1), (error) => isRegistryError(error, "INVALID_RECORD"));
  assert.throws(
    () => validateBaseRecord({ contractVersion: 2, id: "x", owner: { packageName: "p", packageRoot: "/p" } }, 1),
    (error) => isRegistryError(error, "INVALID_RECORD"),
  );
  const target = registry("false-validator", 1, undefined, () => false);
  assert.throws(() => target.register({}, record()), (error) => isRegistryError(error, "INVALID_RECORD"));
});

test("reusable conformance helper checks capability adapters", () => {
  const registryKey = key("conformance");
  const report = assertRegistryConformance({
    createRegistry: () => createCapabilityRegistry({
      registryKey,
      contractVersion: "v1",
      validate: (candidate) => {
        if (typeof candidate.marker !== "number") throw new Error("marker required");
      },
    }),
    createRecord: ({ id, owner, marker }) => ({ contractVersion: "v1", id, owner, marker }),
    getMarker: (candidate) => candidate.marker,
  });
  assert.equal(report.passed, true);
  assert.deepEqual(report.checks, [
    "shared facade rendezvous",
    "scope isolation",
    "same-owner replacement",
    "stale-token protection",
    "cross-owner id conflict",
    "atomic rejected mutation",
    "immutable snapshot",
    "idempotent cleanup",
  ]);
});
