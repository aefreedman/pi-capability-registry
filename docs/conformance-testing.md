# Conformance testing

The `@aefree/pi-capability-registry/conformance` export provides deterministic shared checks without requiring a particular test framework.

The search contract below is hypothetical, not an installable package.

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

The helper checks:

- rendezvous between separate registry facades;
- runtime-scope isolation;
- same-owner atomic replacement;
- stale-token protection;
- cross-owner ID conflicts;
- immutable snapshots; and
- idempotent cleanup.

A passing report proves only the generic lifecycle contract. Capability packages must additionally test:

- their record validator;
- supported and incompatible contract versions;
- provider selection and duplicate behavior;
- missing-provider diagnostics;
- callback execution context;
- startup in both provider-first and consumer-first order; and
- lifecycle cleanup through the actual extension entrypoint.

## Packed-consumer evidence

Workspace links can hide distribution defects. Before release, pack the registry and its consumers, install the tarballs in a neutral temporary project, and verify imports and composition there.

The repository's `tests/foundation-packed-harness.test.mjs` builds and packs Capability Registry, Package References, and Project Artifacts from sibling repository checkouts. It verifies ten public imports with only the expected Package References rendezvous initialization, separate physical copies, both registration orders, and missing/incompatible/duplicate diagnostics. It does not exercise a real Pi host or invoke provider callbacks.

This cross-package harness requires all three repository checkouts and their development dependencies. Run it serially after their source changes are complete; it builds each sibling package. It is repository-only validation, not a command supported by an installed npm artifact.

Run package validation from this package's manifest root:

```bash
npm test
npm run pack:check
```

Review the `npm pack --dry-run` file list and ensure the `docs/` directory is present in the published tarball.
