export type RegistryVersion = string | number;
export type CatalogStatus = "missing" | "compatible" | "incompatible";
export interface RegistryOwner {
    readonly packageName: string;
    readonly packageRoot: string;
    readonly packageVersion?: string;
    readonly [key: string]: unknown;
}
export interface RegistryRecord {
    readonly contractVersion: RegistryVersion;
    readonly id: string;
    readonly owner: RegistryOwner;
    readonly [key: string]: unknown;
}
export type RegistryErrorCode = "INVALID_OPTIONS" | "INVALID_SCOPE" | "INVALID_RECORD" | "REGISTRY_ROOT_INCOMPATIBLE" | "VERSION_STATE_INCOMPATIBLE" | "PROVIDER_ID_CONFLICT";
export declare class RegistryError extends Error {
    readonly code: RegistryErrorCode;
    readonly details: Readonly<Record<string, unknown>>;
    constructor(code: RegistryErrorCode, message: string, details?: Record<string, unknown>);
}
export declare function isRegistryError(error: unknown, code?: RegistryErrorCode): error is RegistryError;
export interface RegistrationToken {
    readonly registryKey: string;
    readonly contractVersion: RegistryVersion;
    readonly scope: object;
    readonly ownerKey: string;
    readonly id: string;
    readonly nonce: number;
}
export interface VersionCatalogRegistration {
    readonly id: string;
    readonly packageName: string;
    readonly packageVersion?: string;
    readonly contractVersion: RegistryVersion;
    /** Safe, bounded source provenance only. Absolute/private paths are omitted. */
    readonly registeredBy?: string;
}
export interface VersionCatalogEntry {
    readonly version: RegistryVersion;
    readonly count: number;
    readonly compatible: boolean;
    /** Callback-free public identities; installation roots are never exposed. */
    readonly registrations: readonly VersionCatalogRegistration[];
}
export interface VersionCatalog {
    readonly registryKey: string;
    readonly requestedVersion: RegistryVersion;
    readonly compatibleVersions: readonly RegistryVersion[];
    readonly status: CatalogStatus;
    readonly versions: readonly VersionCatalogEntry[];
}
export interface CreateCapabilityRegistryOptions<TRecord extends RegistryRecord> {
    /** A stable, capability-specific global symbol key shared by every contract version. */
    readonly registryKey: string;
    readonly contractVersion: RegistryVersion;
    /** Versions whose records this contract understands. Defaults to only contractVersion. */
    readonly compatibleVersions?: readonly RegistryVersion[];
    /** Capability-specific eager structural validation. Throw or return false to reject. */
    readonly validate?: (record: unknown) => void | boolean;
}
export interface CapabilityRegistry<TRecord extends RegistryRecord> {
    readonly registryKey: string;
    readonly contractVersion: RegistryVersion;
    readonly compatibleVersions: readonly RegistryVersion[];
    register(scope: object, record: TRecord): RegistrationToken;
    unregister(token: RegistrationToken | undefined | null): boolean;
    snapshot(scope: object): readonly Readonly<TRecord>[];
    snapshotCompatible(scope: object): readonly Readonly<TRecord>[];
    catalog(scope: object): VersionCatalog;
}
export declare function createCapabilityRegistry<TRecord extends RegistryRecord>(options: CreateCapabilityRegistryOptions<TRecord>): CapabilityRegistry<TRecord>;
export declare function assertRuntimeScope(scope: unknown): asserts scope is object;
export declare function validateBaseRecord(record: unknown, expectedVersion?: RegistryVersion): asserts record is RegistryRecord;
//# sourceMappingURL=index.d.ts.map