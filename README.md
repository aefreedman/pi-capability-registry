# @aefree/pi-capability-registry

A small, code-only registry kernel for capability contracts shared by independently loaded Pi packages.

It provides generic mechanics only: runtime scoping, version catalogs, owner/conflict rules, immutable snapshots, registration tokens, and conformance helpers. Capability packages remain responsible for their record schemas, validators, provider selection, and workflow semantics.

## Properties

- No Pi manifest, resources, commands, or import-time registration.
- No Pi runtime dependencies.
- Plain structural records that interoperate across separate physical package copies.
- A capability-specific `globalThis[Symbol.for(registryKey)]` rendezvous root.
- `WeakMap` isolation by an explicitly supplied runtime scope (normally `ctx.sessionManager`).
- Eager base and capability-specific validation.
- Atomic replacement for the same `packageName` + `packageRoot` + provider `id` owner identity.
- Explicit diagnostics when a different owner claims an existing provider ID in one contract version and runtime scope.
- Monotonic registration-token nonces, stale-token protection, and idempotent cleanup.
- Detached, recursively frozen plain-object/array snapshots. Functions are intentionally retained as opaque callback references.
- Version catalogs that distinguish no registrations from registrations available only at incompatible contract versions and expose only immutable callback-free registration identity (`id`, package/version, contract version, and safe `registeredBy`), never `packageRoot`.

## Install

```bash
npm install @aefree/pi-capability-registry
```

This package is private during Wave 0 incubation.

## Usage

A capability contract owns a stable catalog key, version, record type, and validator:

```ts
import {
  createCapabilityRegistry,
  type RegistryRecord,
} from "@aefree/pi-capability-registry";

interface SearchProvider extends RegistryRecord {
  contractVersion: 1;
  kind: "repo-search";
  marker?: number; // optional test-only field used by the conformance example below
  search(executionContext: { cwd: string }, query: string): Promise<unknown>;
}

export function createSearchRegistry() {
  return createCapabilityRegistry<SearchProvider>({
    registryKey: "@aefree/pi-repo-search/providers",
    contractVersion: 1,
    compatibleVersions: [1],
    validate(record) {
      const candidate = record as Partial<SearchProvider>;
      if (candidate.kind !== "repo-search") throw new Error("kind must be repo-search");
      if (typeof candidate.search !== "function") throw new Error("search callback is required");
    },
  });
}

export const searchProviders = createSearchRegistry();
```

Register on `session_start` and retain the returned token:

```ts
let token: ReturnType<typeof searchProviders.register> | undefined;

pi.on("session_start", (_event, ctx) => {
  token = searchProviders.register(ctx.sessionManager, {
    contractVersion: 1,
    id: "plastic-repo-search",
    kind: "repo-search",
    owner: {
      packageName: "@aefree/pi-plastic",
      packageVersion: "1.0.0",
      packageRoot: import.meta.dirname,
    },
    search: async (executionContext, query) => runSearch(executionContext.cwd, query),
  });
});

pi.on("session_shutdown", () => {
  searchProviders.unregister(token); // safe when stale, repeated, or undefined
  token = undefined;
});
```

Resolve at execution time, not during extension factory or startup order:

```ts
const providers = searchProviders.snapshot(ctx.sessionManager);
const results = await providers[0]?.search(
  { cwd: ctx.cwd, signal: invocationAbortController.signal },
  "Physics.Raycast",
);
```

Provider callbacks should receive fresh execution context. They must not capture an `ExtensionAPI`, `ExtensionContext`, session manager, project cwd, abort signal, UI handle, or another session-bound object. The registry cannot inspect JavaScript closures, so capability packages must document and test this obligation.

## Versions and catalogs

Every contract version uses the same stable `registryKey`; the kernel stores each version in an isolated version state beneath that catalog root. `snapshot()` returns only the registry's exact version. `snapshotCompatible()` returns records from the declared compatible versions in declaration order.

```ts
const catalog = searchProviders.catalog(ctx.sessionManager);

switch (catalog.status) {
  case "missing":
    // No versions have records in this runtime scope.
    break;
  case "incompatible":
    // Records exist, but only at versions this consumer did not declare compatible.
    // Each entry includes safe callback-free registration identities, not package roots.
    console.error(catalog.versions);
    break;
  case "compatible":
    // At least one declared compatible version has records.
    break;
}
```

Compatibility is explicit. The registry does not infer SemVer compatibility or adapt one record schema to another.

## Ownership and replacement

Owner identity is `owner.packageName`, `owner.packageRoot`, and record `id`. `owner.packageVersion` is provenance, not identity, so a reloaded or upgraded physical owner replaces its prior registration atomically. A rejected validator, structural clone, or ID-conflict check leaves the current registration untouched.

A registration token includes the registry key, contract version, runtime scope identity, owner key, provider ID, and monotonically increasing nonce. Only the current token can remove its registration. Tokens are lifecycle handles, not security credentials.

## Snapshot immutability

Records must be plain structural objects composed of primitives, functions, arrays, and plain objects. The kernel rejects cycles, symbols, accessors, symbol-keyed properties, and exotic mutable objects such as `Map` or `Date`. Registration clones and freezes arrays and plain objects, preventing later mutation of the input from changing a snapshot. Functions are not cloned or frozen and remain opaque references.

## Conformance helper

Capability packages can exercise the common behavior without adopting a test framework:

```ts
import { assertRegistryConformance } from "@aefree/pi-capability-registry/conformance";

const report = assertRegistryConformance({
  createRegistry: createSearchRegistry,
  createRecord: ({ id, owner, marker }) => ({
    contractVersion: 1,
    id,
    owner,
    kind: "repo-search",
    marker,
    search: async () => marker,
  }),
  getMarker: (record) => record.marker ?? 0,
});
```

The helper checks facade rendezvous, scope isolation, same-owner replacement, stale tokens, cross-owner conflicts, immutable snapshots, and idempotent cleanup. Package-level tests should additionally validate their own schemas and selection behavior. This package's tests also copy the compiled module to two physical locations and prove global rendezvous.

## Lifecycle notes

- Use `ctx.sessionManager` as the runtime scope. Do not use an event bus or an unscoped process-global provider list.
- Register during `session_start`; unregister during `session_shutdown`.
- Query snapshots at tool/workflow execution time because startup visibility depends on extension load order.
- Events may announce successful changes but do not replace snapshot reads. Include the runtime scope in event payloads and remove event listeners on shutdown.
- Pi SDK embedders must arrange shutdown before bare session disposal when cleanup matters. Weak runtime scoping prevents leakage into other sessions and permits garbage collection once an abandoned scope is unreachable.
