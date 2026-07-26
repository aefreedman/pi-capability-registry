import { type CapabilityRegistry, type RegistryOwner, type RegistryRecord } from "./index.js";
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
export declare function assertRegistryConformance<TRecord extends RegistryRecord>(options: RegistryConformanceOptions<TRecord>): RegistryConformanceReport;
//# sourceMappingURL=conformance.d.ts.map