# Installation and loading

## Two different kinds of package

Pi distinguishes between resources it loads and JavaScript modules those resources import.

A user-facing Pi package declares resources such as extensions, skills, prompts, or themes in its `package.json`:

```json
{
  "pi": {
    "extensions": ["./extensions"]
  }
}
```

`@aefree/pi-capability-registry` has no `pi` manifest and no conventional Pi resource directories. Pi therefore has nothing to load from it. It is an ordinary ESM library used by extension code in other packages.

## What happens during installation

A consuming package declares the registry as a runtime dependency:

```json
{
  "dependencies": {
    "@aefree/pi-capability-registry": "^0.1.0"
  }
}
```

When Pi installs an npm or git package, it runs npm installation for that package. npm resolves the consuming package's runtime dependencies. The extension can then import the registry through normal Node.js module resolution.

```text
Pi package settings
└── @aefree/pi-project-artifacts (user-facing package)
    ├── Pi loads its declared extension
    └── npm installs @aefree/pi-capability-registry
        └── extension code imports the registry API
```

The dependency is downloaded, but it is not independently activated as a Pi extension.

## What users need to do

Users install and configure only the user-facing packages they need. They should not:

- add `@aefree/pi-capability-registry` to Pi's `packages` setting;
- pass it through `pi --extension`;
- enable it through `pi config`; or
- expect it to add tools or commands.

Installing it directly with npm is useful only for authors developing a package that imports its API.

## Public distribution and debugging

This package is public on npm. Consumers declare it in `dependencies`; no sibling repository or workspace link is required. Validate packed consumers from a clean directory rather than relying on workspace links.

The tarball includes prebuilt ESM and declarations in `dist/`. Authored TypeScript in `src/` and relative JavaScript/declaration maps are intentionally shipped so Node's `--enable-source-maps` can map runtime errors to source and editors can navigate declarations to their implementation. These source files are debugging material, not additional runtime entry points.

The manifest's build/test scripts are repository-maintainer commands. Rebuilding or running the test suite requires a repository checkout with its development dependencies, tests, and `tsconfig.json`; installed consumers use the prebuilt exports.

## Why separate Pi installs do not provide shared imports

Installing the registry as another entry in Pi settings is not a substitute for declaring it in `dependencies`. Pi packages have separate module roots; one separately installed package is not a shared `node_modules` location for another package.

Each consuming package must therefore make the registry available through its own dependency distribution. Interoperation across physical copies is handled by the registry's global rendezvous protocol, described in [Architecture](architecture.md).
