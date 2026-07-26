const ROOT_PROTOCOL = "@aefree/pi-capability-registry/root";
const ROOT_PROTOCOL_VERSION = 1;

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

export type RegistryErrorCode =
  | "INVALID_OPTIONS"
  | "INVALID_SCOPE"
  | "INVALID_RECORD"
  | "REGISTRY_ROOT_INCOMPATIBLE"
  | "VERSION_STATE_INCOMPATIBLE"
  | "PROVIDER_ID_CONFLICT";

export class RegistryError extends Error {
  readonly code: RegistryErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: RegistryErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "RegistryError";
    this.code = code;
    this.details = freezeStructural(details, "error details") as Readonly<Record<string, unknown>>;
  }
}

export function isRegistryError(error: unknown, code?: RegistryErrorCode): error is RegistryError {
  if (!isPlainObject(error) && !(error instanceof Error)) return false;
  const candidate = error as { name?: unknown; code?: unknown };
  return candidate.name === "RegistryError" &&
    typeof candidate.code === "string" &&
    (code === undefined || candidate.code === code);
}

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

interface StoredRecord {
  nonce: number;
  record: Readonly<RegistryRecord>;
}

interface ScopedState {
  sequence: number;
  records: Map<string, StoredRecord>;
}

interface VersionState {
  version: RegistryVersion;
  scopes: WeakMap<object, ScopedState>;
}

interface RegistryRoot {
  protocol: typeof ROOT_PROTOCOL;
  protocolVersion: typeof ROOT_PROTOCOL_VERSION;
  registryKey: string;
  versions: Map<RegistryVersion, VersionState>;
}

const EMPTY_SNAPSHOT = Object.freeze([]) as readonly Readonly<RegistryRecord>[];

export function createCapabilityRegistry<TRecord extends RegistryRecord>(
  options: CreateCapabilityRegistryOptions<TRecord>,
): CapabilityRegistry<TRecord> {
  validateOptions(options);
  const { registryKey, contractVersion, validate } = options;
  const compatibleVersions = normalizeCompatibleVersions(contractVersion, options.compatibleVersions);
  const root = getOrCreateRoot(registryKey);
  const currentVersionState = getOrCreateVersionState(root, contractVersion);

  return Object.freeze({
    registryKey,
    contractVersion,
    compatibleVersions,

    register(scope: object, record: TRecord): RegistrationToken {
      assertRuntimeScope(scope);
      validateBaseRecord(record, contractVersion);
      if (validate !== undefined) {
        let result: void | boolean;
        try {
          result = validate(record);
        } catch (error) {
          throw new RegistryError("INVALID_RECORD", `Validation failed for registry '${registryKey}': ${errorMessage(error)}`, {
            registryKey,
            contractVersion,
            cause: errorMessage(error),
          });
        }
        if (result === false) {
          throw new RegistryError("INVALID_RECORD", `Validation failed for registry '${registryKey}'`, {
            registryKey,
            contractVersion,
          });
        }
      }

      // Clone and freeze before observing or mutating registry state. A failed clone or
      // validation therefore cannot partially replace the current owner's record.
      const frozenRecord = freezeStructural(record, "record") as Readonly<TRecord>;
      const state = getScopedState(currentVersionState, scope, true);
      const key = ownerKey(frozenRecord);

      for (const current of state.records.values()) {
        if (current.record.id === frozenRecord.id && ownerKey(current.record) !== key) {
          throw new RegistryError(
            "PROVIDER_ID_CONFLICT",
            `Provider id '${frozenRecord.id}' in registry '${registryKey}' version '${String(contractVersion)}' is already owned by '${current.record.owner.packageName}'`,
            {
              registryKey,
              contractVersion,
              id: frozenRecord.id,
              existingOwner: current.record.owner,
              attemptedOwner: frozenRecord.owner,
            },
          );
        }
      }

      const nonce = state.sequence + 1;
      state.records.set(key, { nonce, record: frozenRecord });
      state.sequence = nonce;
      return Object.freeze({
        registryKey,
        contractVersion,
        scope,
        ownerKey: key,
        id: frozenRecord.id,
        nonce,
      });
    },

    unregister(token: RegistrationToken | undefined | null): boolean {
      if (!isMatchingToken(token, registryKey, contractVersion)) return false;
      const state = getScopedState(currentVersionState, token.scope, false);
      if (state === undefined) return false;
      const current = state.records.get(token.ownerKey);
      if (current === undefined || current.nonce !== token.nonce || current.record.id !== token.id) return false;
      state.records.delete(token.ownerKey);
      return true;
    },

    snapshot(scope: object): readonly Readonly<TRecord>[] {
      assertRuntimeScope(scope);
      return snapshotVersions<TRecord>(root, scope, [contractVersion]);
    },

    snapshotCompatible(scope: object): readonly Readonly<TRecord>[] {
      assertRuntimeScope(scope);
      return snapshotVersions<TRecord>(root, scope, compatibleVersions);
    },

    catalog(scope: object): VersionCatalog {
      assertRuntimeScope(scope);
      const compatible = new Set(compatibleVersions);
      const versions: VersionCatalogEntry[] = [];
      for (const [version, versionState] of root.versions) {
        assertVersionState(versionState, version, registryKey);
        const scoped = versionState.scopes.get(scope);
        const registrations = scoped === undefined
          ? []
          : [...scoped.records.values()].map(({ record }) => catalogRegistration(record));
        if (registrations.length > 0) {
          versions.push(Object.freeze({
            version,
            count: registrations.length,
            compatible: compatible.has(version),
            registrations: Object.freeze(registrations),
          }));
        }
      }
      const hasCompatible = versions.some((entry) => entry.compatible);
      const status: CatalogStatus = versions.length === 0
        ? "missing"
        : hasCompatible ? "compatible" : "incompatible";
      return Object.freeze({
        registryKey,
        requestedVersion: contractVersion,
        compatibleVersions,
        status,
        versions: Object.freeze(versions),
      });
    },
  });
}

export function assertRuntimeScope(scope: unknown): asserts scope is object {
  if ((typeof scope !== "object" && typeof scope !== "function") || scope === null) {
    throw new RegistryError("INVALID_SCOPE", "A shared runtime scope object is required");
  }
}

export function validateBaseRecord(record: unknown, expectedVersion?: RegistryVersion): asserts record is RegistryRecord {
  if (!isPlainObject(record)) {
    throw new RegistryError("INVALID_RECORD", "Registration record must be a plain object");
  }
  if (typeof record.id !== "string" || record.id.trim() === "") {
    throw new RegistryError("INVALID_RECORD", "Registration record id must be a non-empty string");
  }
  validateVersion(record.contractVersion, "record contractVersion", "INVALID_RECORD");
  if (expectedVersion !== undefined && !Object.is(record.contractVersion, expectedVersion)) {
    throw new RegistryError(
      "INVALID_RECORD",
      `Registration record contractVersion '${String(record.contractVersion)}' does not match registry version '${String(expectedVersion)}'`,
    );
  }
  if (!isPlainObject(record.owner)) {
    throw new RegistryError("INVALID_RECORD", "Registration record owner must be a plain object");
  }
  if (typeof record.owner.packageName !== "string" || record.owner.packageName.trim() === "") {
    throw new RegistryError("INVALID_RECORD", "Registration owner packageName must be a non-empty string");
  }
  if (typeof record.owner.packageRoot !== "string" || record.owner.packageRoot.trim() === "") {
    throw new RegistryError("INVALID_RECORD", "Registration owner packageRoot must be a non-empty string");
  }
  if (record.owner.packageVersion !== undefined &&
      (typeof record.owner.packageVersion !== "string" || record.owner.packageVersion.trim() === "")) {
    throw new RegistryError("INVALID_RECORD", "Registration owner packageVersion must be a non-empty string when supplied");
  }
}

function validateOptions<TRecord extends RegistryRecord>(
  options: CreateCapabilityRegistryOptions<TRecord>,
): void {
  if (!isPlainObject(options)) {
    throw new RegistryError("INVALID_OPTIONS", "Registry options must be a plain object");
  }
  if (typeof options.registryKey !== "string" || options.registryKey.trim() === "") {
    throw new RegistryError("INVALID_OPTIONS", "registryKey must be a non-empty string");
  }
  validateVersion(options.contractVersion, "contractVersion", "INVALID_OPTIONS");
  if (options.validate !== undefined && typeof options.validate !== "function") {
    throw new RegistryError("INVALID_OPTIONS", "validate must be a function when supplied");
  }
  if (options.compatibleVersions !== undefined && !Array.isArray(options.compatibleVersions)) {
    throw new RegistryError("INVALID_OPTIONS", "compatibleVersions must be an array when supplied");
  }
}

function validateVersion(version: unknown, label: string, code: RegistryErrorCode): asserts version is RegistryVersion {
  const validString = typeof version === "string" && version.trim() !== "";
  const validNumber = typeof version === "number" && Number.isFinite(version);
  if (!validString && !validNumber) {
    throw new RegistryError(code, `${label} must be a non-empty string or finite number`);
  }
}

function normalizeCompatibleVersions(
  contractVersion: RegistryVersion,
  configured: readonly RegistryVersion[] | undefined,
): readonly RegistryVersion[] {
  const source = configured ?? [contractVersion];
  const result: RegistryVersion[] = [];
  for (const version of source) {
    validateVersion(version, "compatible version", "INVALID_OPTIONS");
    if (!result.some((current) => Object.is(current, version))) result.push(version);
  }
  if (!result.some((current) => Object.is(current, contractVersion))) {
    result.unshift(contractVersion);
  }
  return Object.freeze(result);
}

function getOrCreateRoot(registryKey: string): RegistryRoot {
  const symbol = Symbol.for(registryKey);
  const globalRecord = globalThis as typeof globalThis & Record<symbol, unknown>;
  const existing = globalRecord[symbol];
  if (existing !== undefined) {
    assertRoot(existing, registryKey);
    return existing;
  }
  const created: RegistryRoot = {
    protocol: ROOT_PROTOCOL,
    protocolVersion: ROOT_PROTOCOL_VERSION,
    registryKey,
    versions: new Map(),
  };
  globalRecord[symbol] = created;
  return created;
}

function assertRoot(value: unknown, registryKey: string): asserts value is RegistryRoot {
  if (!isPlainObject(value) ||
      value.protocol !== ROOT_PROTOCOL ||
      value.protocolVersion !== ROOT_PROTOCOL_VERSION ||
      value.registryKey !== registryKey ||
      !(value.versions instanceof Map)) {
    throw new RegistryError(
      "REGISTRY_ROOT_INCOMPATIBLE",
      `Incompatible registry root for '${registryKey}'`,
      { registryKey, expectedProtocol: ROOT_PROTOCOL, expectedProtocolVersion: ROOT_PROTOCOL_VERSION },
    );
  }
}

function getOrCreateVersionState(root: RegistryRoot, version: RegistryVersion): VersionState {
  const existing = root.versions.get(version);
  if (existing !== undefined) {
    assertVersionState(existing, version, root.registryKey);
    return existing;
  }
  const created: VersionState = { version, scopes: new WeakMap() };
  root.versions.set(version, created);
  return created;
}

function assertVersionState(value: unknown, version: RegistryVersion, registryKey: string): asserts value is VersionState {
  if (!isPlainObject(value) || !Object.is(value.version, version) || !(value.scopes instanceof WeakMap)) {
    throw new RegistryError(
      "VERSION_STATE_INCOMPATIBLE",
      `Incompatible version state for '${registryKey}' version '${String(version)}'`,
      { registryKey, contractVersion: version },
    );
  }
}

function getScopedState(versionState: VersionState, scope: object, create: true): ScopedState;
function getScopedState(versionState: VersionState, scope: object, create: false): ScopedState | undefined;
function getScopedState(versionState: VersionState, scope: object, create: boolean): ScopedState | undefined {
  const existing = versionState.scopes.get(scope);
  if (existing !== undefined) {
    if (!isPlainObject(existing) ||
        !Number.isSafeInteger(existing.sequence) ||
        existing.sequence < 0 ||
        !(existing.records instanceof Map)) {
      throw new RegistryError(
        "VERSION_STATE_INCOMPATIBLE",
        `Incompatible scoped state for version '${String(versionState.version)}'`,
      );
    }
    return existing;
  }
  if (!create) return undefined;
  const created: ScopedState = { sequence: 0, records: new Map() };
  versionState.scopes.set(scope, created);
  return created;
}

function snapshotVersions<TRecord extends RegistryRecord>(
  root: RegistryRoot,
  scope: object,
  versions: readonly RegistryVersion[],
): readonly Readonly<TRecord>[] {
  const records: Readonly<TRecord>[] = [];
  for (const version of versions) {
    const versionState = root.versions.get(version);
    if (versionState === undefined) continue;
    assertVersionState(versionState, version, root.registryKey);
    const scoped = getScopedState(versionState, scope, false);
    if (scoped === undefined) continue;
    for (const stored of scoped.records.values()) {
      records.push(stored.record as Readonly<TRecord>);
    }
  }
  return records.length === 0 ? EMPTY_SNAPSHOT as readonly Readonly<TRecord>[] : Object.freeze(records);
}

function ownerKey(record: Readonly<RegistryRecord>): string {
  return [record.owner.packageName, record.owner.packageRoot, record.id].join("\u0000");
}

function catalogRegistration(record: Readonly<RegistryRecord>): Readonly<VersionCatalogRegistration> {
  const registeredBy = safeRegisteredBy(record.owner.registeredBy);
  return Object.freeze({
    id: record.id,
    packageName: record.owner.packageName,
    ...(record.owner.packageVersion === undefined ? {} : { packageVersion: record.owner.packageVersion }),
    contractVersion: record.contractVersion,
    ...(registeredBy === undefined ? {} : { registeredBy }),
  });
}

function safeRegisteredBy(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > 256 || value.trim() !== value) return undefined;
  if (/[\u0000-\u001f\u007f]/.test(value) || value.startsWith("file:") || value.startsWith("/") || value.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(value)) return undefined;
  const segments = value.replaceAll("\\", "/").split("/");
  return segments.some((segment) => segment === "..") ? undefined : value;
}

function isMatchingToken(
  token: RegistrationToken | undefined | null,
  registryKey: string,
  contractVersion: RegistryVersion,
): token is RegistrationToken {
  return token !== undefined && token !== null &&
    isPlainObject(token) &&
    token.registryKey === registryKey &&
    Object.is(token.contractVersion, contractVersion) &&
    (typeof token.scope === "object" || typeof token.scope === "function") &&
    token.scope !== null &&
    typeof token.ownerKey === "string" &&
    typeof token.id === "string" &&
    Number.isSafeInteger(token.nonce) && token.nonce > 0;
}

function freezeStructural<T>(value: T, label: string, active = new WeakSet<object>()): T {
  if (value === null || value === undefined) return value;
  const valueType = typeof value;
  if (valueType === "string" || valueType === "number" || valueType === "boolean" || valueType === "bigint") return value;
  if (valueType === "function") return value;
  if (valueType === "symbol") {
    throw new RegistryError("INVALID_RECORD", `${label} contains a symbol value, which is not structurally interoperable`);
  }
  if (valueType !== "object") return value;

  const objectValue = value as object;
  if (active.has(objectValue)) {
    throw new RegistryError("INVALID_RECORD", `${label} contains a cycle`);
  }
  active.add(objectValue);
  try {
    if (Array.isArray(value)) {
      return Object.freeze(value.map((entry) => freezeStructural(entry, label, active))) as T;
    }
    if (!isPlainObject(value)) {
      throw new RegistryError("INVALID_RECORD", `${label} contains a non-plain object`);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new RegistryError("INVALID_RECORD", `${label} contains symbol-keyed properties`);
    }
    const clone: Record<string, unknown> = {};
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!descriptor.enumerable || !("value" in descriptor)) {
        throw new RegistryError("INVALID_RECORD", `${label}.${key} must be an enumerable data property`);
      }
      clone[key] = freezeStructural(descriptor.value, `${label}.${key}`, active);
    }
    return Object.freeze(clone) as T;
  } finally {
    active.delete(objectValue);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
