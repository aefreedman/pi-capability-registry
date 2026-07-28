# Lifecycle and usage

## 1. Define a capability contract

A capability package owns the stable key, contract version, record type, and validation.

```ts
import {
  createCapabilityRegistry,
  type RegistryRecord,
} from "@aefree/pi-capability-registry";

interface SearchProvider extends RegistryRecord {
  contractVersion: 1;
  kind: "repo-search";
  search(
    executionContext: { cwd: string; signal?: AbortSignal },
    query: string,
  ): Promise<unknown>;
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

Use the same stable key for every version of one capability. A new version receives separate state beneath that key.

## 2. Register for the session lifecycle

A provider extension registers during `session_start`, retains its token, and unregisters during `session_shutdown`.

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
      registeredBy: "extensions/repository-search-provider.ts",
    },
    search: async (executionContext, query) =>
      runSearch(executionContext.cwd, query, executionContext.signal),
  });
});

pi.on("session_shutdown", () => {
  searchProviders.unregister(token);
  token = undefined;
});
```

`unregister` is safe with an undefined, stale, or already-used token.

SDK embedders must arrange lifecycle shutdown when cleanup matters. Disposing a bare session without the extension shutdown lifecycle does not invoke this cleanup.

## 3. Resolve at execution time

Do not resolve providers in the extension factory or assume extension startup order. Read the current runtime scope when the tool or workflow executes.

```ts
const providers = searchProviders.snapshot(ctx.sessionManager);
const provider = providers[0];

if (provider) {
  return provider.search(
    { cwd: ctx.cwd, signal },
    "Physics.Raycast",
  );
}
```

Capability packages should usually wrap raw snapshots with domain-specific resolution. For example, a capability may diagnose missing, incompatible, or duplicate registrations rather than letting every consumer invent that behavior.

## Catalog diagnostics

Use `catalog(scope)` when a consumer needs to distinguish missing registrations from incompatible versions:

```ts
const catalog = searchProviders.catalog(ctx.sessionManager);

switch (catalog.status) {
  case "missing":
    // No contract version has records in this runtime scope.
    break;
  case "incompatible":
    // Records exist, but none use a declared compatible version.
    console.error(catalog.versions);
    break;
  case "compatible":
    // At least one compatible version has records.
    break;
}
```

Catalog entries expose safe registration provenance but never callbacks or `packageRoot`.

## Callback safety

Provider callbacks should receive a fresh execution context for each invocation. Do not capture any of these in a long-lived registered callback:

- `ExtensionAPI`;
- `ExtensionContext`;
- the session manager;
- project cwd;
- abort signals;
- UI handles; or
- other session-bound objects.

The registry cannot inspect closures, so capability packages must document and test this rule.

## Failure behavior

Registration validates the generic record shape and then runs the capability validator. Structural cloning, validation, and ID-conflict checks occur before replacement is committed. If any step fails, the current registration remains available.

Use `isRegistryError(error, code)` when capability-specific diagnostics need to recognize kernel failures.
