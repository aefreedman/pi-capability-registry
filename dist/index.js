const ROOT_PROTOCOL = "@aefree/pi-capability-registry/root";
const ROOT_PROTOCOL_VERSION = 1;
export class RegistryError extends Error {
    code;
    details;
    constructor(code, message, details = {}) {
        super(message);
        this.name = "RegistryError";
        this.code = code;
        this.details = freezeStructural(details, "error details");
    }
}
export function isRegistryError(error, code) {
    if (!isPlainObject(error) && !(error instanceof Error))
        return false;
    const candidate = error;
    return candidate.name === "RegistryError" &&
        typeof candidate.code === "string" &&
        (code === undefined || candidate.code === code);
}
const EMPTY_SNAPSHOT = Object.freeze([]);
export function createCapabilityRegistry(options) {
    validateOptions(options);
    const { registryKey, contractVersion, validate } = options;
    const compatibleVersions = normalizeCompatibleVersions(contractVersion, options.compatibleVersions);
    const root = getOrCreateRoot(registryKey);
    const currentVersionState = getOrCreateVersionState(root, contractVersion);
    return Object.freeze({
        registryKey,
        contractVersion,
        compatibleVersions,
        register(scope, record) {
            assertRuntimeScope(scope);
            validateBaseRecord(record, contractVersion);
            if (validate !== undefined) {
                let result;
                try {
                    result = validate(record);
                }
                catch (error) {
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
            const frozenRecord = freezeStructural(record, "record");
            const state = getScopedState(currentVersionState, scope, true);
            const key = ownerKey(frozenRecord);
            for (const current of state.records.values()) {
                if (current.record.id === frozenRecord.id && ownerKey(current.record) !== key) {
                    throw new RegistryError("PROVIDER_ID_CONFLICT", `Provider id '${frozenRecord.id}' in registry '${registryKey}' version '${String(contractVersion)}' is already owned by '${current.record.owner.packageName}'`, {
                        registryKey,
                        contractVersion,
                        id: frozenRecord.id,
                        existingOwner: current.record.owner,
                        attemptedOwner: frozenRecord.owner,
                    });
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
        unregister(token) {
            if (!isMatchingToken(token, registryKey, contractVersion))
                return false;
            const state = getScopedState(currentVersionState, token.scope, false);
            if (state === undefined)
                return false;
            const current = state.records.get(token.ownerKey);
            if (current === undefined || current.nonce !== token.nonce || current.record.id !== token.id)
                return false;
            state.records.delete(token.ownerKey);
            return true;
        },
        snapshot(scope) {
            assertRuntimeScope(scope);
            return snapshotVersions(root, scope, [contractVersion]);
        },
        snapshotCompatible(scope) {
            assertRuntimeScope(scope);
            return snapshotVersions(root, scope, compatibleVersions);
        },
        catalog(scope) {
            assertRuntimeScope(scope);
            const compatible = new Set(compatibleVersions);
            const versions = [];
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
            const status = versions.length === 0
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
export function assertRuntimeScope(scope) {
    if ((typeof scope !== "object" && typeof scope !== "function") || scope === null) {
        throw new RegistryError("INVALID_SCOPE", "A shared runtime scope object is required");
    }
}
export function validateBaseRecord(record, expectedVersion) {
    if (!isPlainObject(record)) {
        throw new RegistryError("INVALID_RECORD", "Registration record must be a plain object");
    }
    if (typeof record.id !== "string" || record.id.trim() === "") {
        throw new RegistryError("INVALID_RECORD", "Registration record id must be a non-empty string");
    }
    validateVersion(record.contractVersion, "record contractVersion", "INVALID_RECORD");
    if (expectedVersion !== undefined && !Object.is(record.contractVersion, expectedVersion)) {
        throw new RegistryError("INVALID_RECORD", `Registration record contractVersion '${String(record.contractVersion)}' does not match registry version '${String(expectedVersion)}'`);
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
function validateOptions(options) {
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
function validateVersion(version, label, code) {
    const validString = typeof version === "string" && version.trim() !== "";
    const validNumber = typeof version === "number" && Number.isFinite(version);
    if (!validString && !validNumber) {
        throw new RegistryError(code, `${label} must be a non-empty string or finite number`);
    }
}
function normalizeCompatibleVersions(contractVersion, configured) {
    const source = configured ?? [contractVersion];
    const result = [];
    for (const version of source) {
        validateVersion(version, "compatible version", "INVALID_OPTIONS");
        if (!result.some((current) => Object.is(current, version)))
            result.push(version);
    }
    if (!result.some((current) => Object.is(current, contractVersion))) {
        result.unshift(contractVersion);
    }
    return Object.freeze(result);
}
function getOrCreateRoot(registryKey) {
    const symbol = Symbol.for(registryKey);
    const globalRecord = globalThis;
    const existing = globalRecord[symbol];
    if (existing !== undefined) {
        assertRoot(existing, registryKey);
        return existing;
    }
    const created = {
        protocol: ROOT_PROTOCOL,
        protocolVersion: ROOT_PROTOCOL_VERSION,
        registryKey,
        versions: new Map(),
    };
    globalRecord[symbol] = created;
    return created;
}
function assertRoot(value, registryKey) {
    if (!isPlainObject(value) ||
        value.protocol !== ROOT_PROTOCOL ||
        value.protocolVersion !== ROOT_PROTOCOL_VERSION ||
        value.registryKey !== registryKey ||
        !(value.versions instanceof Map)) {
        throw new RegistryError("REGISTRY_ROOT_INCOMPATIBLE", `Incompatible registry root for '${registryKey}'`, { registryKey, expectedProtocol: ROOT_PROTOCOL, expectedProtocolVersion: ROOT_PROTOCOL_VERSION });
    }
}
function getOrCreateVersionState(root, version) {
    const existing = root.versions.get(version);
    if (existing !== undefined) {
        assertVersionState(existing, version, root.registryKey);
        return existing;
    }
    const created = { version, scopes: new WeakMap() };
    root.versions.set(version, created);
    return created;
}
function assertVersionState(value, version, registryKey) {
    if (!isPlainObject(value) || !Object.is(value.version, version) || !(value.scopes instanceof WeakMap)) {
        throw new RegistryError("VERSION_STATE_INCOMPATIBLE", `Incompatible version state for '${registryKey}' version '${String(version)}'`, { registryKey, contractVersion: version });
    }
}
function getScopedState(versionState, scope, create) {
    const existing = versionState.scopes.get(scope);
    if (existing !== undefined) {
        if (!isPlainObject(existing) ||
            !Number.isSafeInteger(existing.sequence) ||
            existing.sequence < 0 ||
            !(existing.records instanceof Map)) {
            throw new RegistryError("VERSION_STATE_INCOMPATIBLE", `Incompatible scoped state for version '${String(versionState.version)}'`);
        }
        return existing;
    }
    if (!create)
        return undefined;
    const created = { sequence: 0, records: new Map() };
    versionState.scopes.set(scope, created);
    return created;
}
function snapshotVersions(root, scope, versions) {
    const records = [];
    for (const version of versions) {
        const versionState = root.versions.get(version);
        if (versionState === undefined)
            continue;
        assertVersionState(versionState, version, root.registryKey);
        const scoped = getScopedState(versionState, scope, false);
        if (scoped === undefined)
            continue;
        for (const stored of scoped.records.values()) {
            records.push(stored.record);
        }
    }
    return records.length === 0 ? EMPTY_SNAPSHOT : Object.freeze(records);
}
function ownerKey(record) {
    return [record.owner.packageName, record.owner.packageRoot, record.id].join("\u0000");
}
function catalogRegistration(record) {
    const registeredBy = safeRegisteredBy(record.owner.registeredBy);
    return Object.freeze({
        id: record.id,
        packageName: record.owner.packageName,
        ...(record.owner.packageVersion === undefined ? {} : { packageVersion: record.owner.packageVersion }),
        contractVersion: record.contractVersion,
        ...(registeredBy === undefined ? {} : { registeredBy }),
    });
}
function safeRegisteredBy(value) {
    if (typeof value !== "string" || value.length === 0 || value.length > 256 || value.trim() !== value)
        return undefined;
    if (/[\u0000-\u001f\u007f]/.test(value) || value.startsWith("file:") || value.startsWith("/") || value.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(value))
        return undefined;
    const segments = value.replaceAll("\\", "/").split("/");
    return segments.some((segment) => segment === "..") ? undefined : value;
}
function isMatchingToken(token, registryKey, contractVersion) {
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
function freezeStructural(value, label, active = new WeakSet()) {
    if (value === null || value === undefined)
        return value;
    const valueType = typeof value;
    if (valueType === "string" || valueType === "number" || valueType === "boolean" || valueType === "bigint")
        return value;
    if (valueType === "function")
        return value;
    if (valueType === "symbol") {
        throw new RegistryError("INVALID_RECORD", `${label} contains a symbol value, which is not structurally interoperable`);
    }
    if (valueType !== "object")
        return value;
    const objectValue = value;
    if (active.has(objectValue)) {
        throw new RegistryError("INVALID_RECORD", `${label} contains a cycle`);
    }
    active.add(objectValue);
    try {
        if (Array.isArray(value)) {
            return Object.freeze(value.map((entry) => freezeStructural(entry, label, active)));
        }
        if (!isPlainObject(value)) {
            throw new RegistryError("INVALID_RECORD", `${label} contains a non-plain object`);
        }
        if (Object.getOwnPropertySymbols(value).length > 0) {
            throw new RegistryError("INVALID_RECORD", `${label} contains symbol-keyed properties`);
        }
        const clone = {};
        for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
            if (!descriptor.enumerable || !("value" in descriptor)) {
                throw new RegistryError("INVALID_RECORD", `${label}.${key} must be an enumerable data property`);
            }
            clone[key] = freezeStructural(descriptor.value, `${label}.${key}`, active);
        }
        return Object.freeze(clone);
    }
    finally {
        active.delete(objectValue);
    }
}
function isPlainObject(value) {
    if (value === null || typeof value !== "object")
        return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=index.js.map