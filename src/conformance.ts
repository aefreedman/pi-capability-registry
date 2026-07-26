import {
  isRegistryError,
  type CapabilityRegistry,
  type RegistryOwner,
  type RegistryRecord,
} from "./index.js";

export interface ConformanceRecordInput {
  readonly id: string;
  readonly owner: RegistryOwner;
  readonly marker: number;
}

export interface RegistryConformanceOptions<TRecord extends RegistryRecord> {
  /** Return a fresh facade over the same capability registry key and version. */
  readonly createRegistry: () => CapabilityRegistry<TRecord>;
  readonly createRecord: (input: ConformanceRecordInput) => TRecord;
  readonly getMarker: (record: Readonly<TRecord>) => number;
}

export interface RegistryConformanceReport {
  readonly passed: true;
  readonly checks: readonly string[];
}

/**
 * Runs the common registry contract without depending on a test framework.
 * Capability packages can call this from their own deterministic test suites.
 */
export function assertRegistryConformance<TRecord extends RegistryRecord>(
  options: RegistryConformanceOptions<TRecord>,
): RegistryConformanceReport {
  const first = options.createRegistry();
  const second = options.createRegistry();
  equal(first.registryKey, second.registryKey, "facades must target the same registry key");
  equal(first.contractVersion, second.contractVersion, "facades must target the same contract version");

  const scopeA = {};
  const scopeB = {};
  const id = "registry-conformance-fixture";
  const ownerA = Object.freeze({
    packageName: "@fixture/provider-a",
    packageVersion: "1.0.0",
    packageRoot: "/fixture/provider-a",
  });
  const ownerB = Object.freeze({
    packageName: "@fixture/provider-b",
    packageVersion: "1.0.0",
    packageRoot: "/fixture/provider-b",
  });
  const checks: string[] = [];

  const token1 = first.register(scopeA, options.createRecord({ id, owner: ownerA, marker: 1 }));
  equal(options.getMarker(second.snapshot(scopeA)[0]!), 1, "a second facade must observe registration");
  equal(second.snapshot(scopeB).length, 0, "runtime scopes must be isolated");
  checks.push("shared facade rendezvous", "scope isolation");

  const token2 = second.register(scopeA, options.createRecord({ id, owner: ownerA, marker: 2 }));
  equal(first.snapshot(scopeA).length, 1, "same-owner registration must replace atomically");
  equal(options.getMarker(first.snapshot(scopeA)[0]!), 2, "replacement must expose the new record");
  equal(first.unregister(token1), false, "stale token must not remove replacement");
  checks.push("same-owner replacement", "stale-token protection");

  let conflict: unknown;
  try {
    first.register(scopeA, options.createRecord({ id, owner: ownerB, marker: 3 }));
  } catch (error) {
    conflict = error;
  }
  truthy(isRegistryError(conflict, "PROVIDER_ID_CONFLICT"), "cross-owner id conflict must be diagnosed");
  equal(options.getMarker(first.snapshot(scopeA)[0]!), 2, "conflict must leave current registration intact");
  checks.push("cross-owner id conflict", "atomic rejected mutation");

  const snapshot = first.snapshot(scopeA);
  truthy(Object.isFrozen(snapshot), "snapshot array must be frozen");
  truthy(Object.isFrozen(snapshot[0]), "snapshot record must be frozen");
  truthy(Object.isFrozen(snapshot[0]!.owner), "snapshot owner must be frozen");
  checks.push("immutable snapshot");

  equal(first.unregister(token2), true, "current token must unregister");
  equal(second.unregister(token2), false, "unregister must be idempotent across facades");
  equal(first.snapshot(scopeA).length, 0, "successful cleanup must remove the record");
  checks.push("idempotent cleanup");

  return Object.freeze({ passed: true as const, checks: Object.freeze(checks) });
}

function equal(actual: unknown, expected: unknown, message: string): void {
  if (!Object.is(actual, expected)) {
    throw new Error(`Registry conformance failed: ${message} (expected ${String(expected)}, got ${String(actual)})`);
  }
}

function truthy(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`Registry conformance failed: ${message}`);
}
