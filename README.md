# @aefree/pi-capability-registry

A code-only registry kernel for capability contracts shared by independently loaded Pi packages.

This package is infrastructure for package authors. It is **not a Pi extension** and intentionally provides no tools, commands, skills, prompts, or themes.

## For Pi users

Do not add this package to Pi settings and do not install it separately. Install the user-facing Pi package you want. Its package manager installs this library as a normal runtime dependency.

```text
pi installs a user-facing package
└── npm installs @aefree/pi-capability-registry from dependencies
    └── the user-facing extension imports and uses the library
```

The package is publicly available on npm as a normal runtime dependency.

See [Installation and loading](docs/installation-and-loading.md) for the complete distribution model.

## For package authors

```bash
npm install @aefree/pi-capability-registry
```

```ts
import { createCapabilityRegistry } from "@aefree/pi-capability-registry";
```

Capability packages define their own record schemas, validation, provider selection, and workflow semantics. This library supplies runtime scoping, version catalogs, ownership rules, immutable snapshots, lifecycle tokens, and shared conformance checks.

## Documentation

- [Installation and loading](docs/installation-and-loading.md) — what Pi loads, what npm installs, and what users must configure
- [Architecture](docs/architecture.md) — rendezvous, runtime isolation, versions, ownership, and immutability
- [Lifecycle and usage](docs/lifecycle-and-usage.md) — defining, registering, resolving, and cleaning up a capability
- [Conformance testing](docs/conformance-testing.md) — shared checks and package-specific test responsibilities

## Package status

- ESM-only
- Node.js 20 or newer
- No runtime dependencies
- No Pi manifest or Pi resources
- Public npm library with prebuilt runtime and declarations
- Authored TypeScript and relative source/declaration maps included for debugging

## License

MIT
