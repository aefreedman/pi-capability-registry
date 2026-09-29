# Changelog

All notable changes to this package will be documented in this file.

## 0.1.1 - 2026-09-29

- Pin TypeScript 7.0.2; align direct Node types with the runtime floor.
- Validate the current Capability Registry, Package References, and Project Artifacts contracts in the neutral packed-consumer harness.
- Correct public installation guidance and identify hypothetical search examples explicitly.
- Document the shipped TypeScript/source-map debugging contract and repository-only validation commands.

## 0.1.0 - 2026-07-28

### Added

- Package documentation covering installation/loading, architecture, lifecycle usage, and conformance testing.
- Runtime-scoped, version-aware capability registry kernel.
- Structural base validation and capability-specific validation hooks.
- Atomic same-owner replacement and cross-owner provider-ID diagnostics.
- Immutable structural snapshots and compatible-version catalogs.
- Nonced registration tokens with stale-token and idempotent cleanup behavior.
- Reusable registry conformance helper.
- Deterministic lifecycle, isolation, validation, catalog, immutability, and separate-physical-copy tests.
- Callback-free immutable catalog registration identities with safe provenance and no installation roots.
- Neutral packed-tarball foundation harness covering exported subpaths, physical-copy rendezvous, load orders, and diagnostics.
