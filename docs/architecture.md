# Architecture

## Responsibility boundary

The registry kernel owns generic interoperability mechanics:

- capability-specific global rendezvous roots;
- isolation by runtime scope;
- exact and explicitly compatible contract versions;
- owner replacement and provider-ID conflicts;
- immutable snapshots;
- stale-safe lifecycle tokens; and
- common conformance checks.

Capability packages own everything domain-specific: record types, validators, selection rules, diagnostics, execution context, and workflow behavior.

Importing either the kernel or a capability contract must not register Pi resources or mutate registry records.

## Physical-copy rendezvous

Pi packages can load from separate module roots and can therefore contain separate physical copies of this library. A capability chooses one stable `registryKey`. Every copy rendezvouses through:

```ts
globalThis[Symbol.for(registryKey)]
```

The root is protocol-versioned and contains independent state for each contract version. This lets separately installed providers and consumers find the same capability records without requiring them to share one JavaScript module instance.

The key must identify the capability, not this generic package. For example:

```ts
registryKey: "@aefree/pi-repo-search/providers"
```

## Runtime isolation

Each contract-version state uses a `WeakMap` keyed by an explicitly supplied runtime scope. In Pi extensions, use `ctx.sessionManager`:

```ts
registry.register(ctx.sessionManager, record);
registry.snapshot(ctx.sessionManager);
```

Do not use a process-global provider list or an event bus as authoritative state. One process may host multiple sessions. Weak runtime keys keep those sessions isolated and allow abandoned scopes to be collected.

## Versions and compatibility

Every exact contract version has separate state under the same registry key.

- `snapshot(scope)` returns only records for the facade's exact version.
- `snapshotCompatible(scope)` returns records for explicitly declared compatible versions, in declaration order.
- `catalog(scope)` distinguishes no registrations from registrations that exist only at incompatible versions.

The kernel does not infer compatibility from SemVer and does not adapt records between versions.

## Ownership

Registration identity combines:

- `owner.packageName`;
- `owner.packageRoot`; and
- record `id`.

`owner.packageVersion` is provenance, not identity. A reload or upgrade of the same physical owner replaces its previous record atomically. A different owner claiming the same record ID in the same capability version and runtime scope receives `PROVIDER_ID_CONFLICT`.

Registration returns a token with a monotonically increasing nonce. Only the current token can remove the record, so delayed shutdown from an older extension generation cannot remove its replacement.

## Structural records and snapshots

Records must be plain structural objects composed of primitives, functions, arrays, and plain objects. The kernel rejects cycles, symbols, accessors, symbol-keyed properties, and mutable exotic objects such as `Map` and `Date`.

Registration clones and recursively freezes arrays and plain objects before changing registry state. Functions remain opaque callback references. Failed validation or cloning leaves the previous registration untouched.

Catalog diagnostics expose bounded callback-free identity. They omit `packageRoot` so private installation paths are not disclosed.

## Event buses

Events may announce a successful registry change, but they are not authoritative. Events can be missed because of extension load order and can cross session boundaries if scoped incorrectly. Consumers must read a fresh snapshot when an operation executes.
