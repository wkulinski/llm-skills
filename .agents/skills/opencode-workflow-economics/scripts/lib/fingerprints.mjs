import { sha256 } from "./util.mjs";

export const FINGERPRINT_VERSION = "operation_fingerprint_v2";

const DEFAULTS = {
    step_count_maxima: [1, 4, 8],
    tool_call_count_maxima: [1, 3, 7, 15],
    output_byte_maxima: [1024, 16_384, 131_072],
    include_neighbor_activities: true,
};

export function enrichSpansWithFingerprints(spans, tools, rootSessionId, config = {}) {
    const settings = { ...DEFAULTS, ...(config ?? {}) };
    const toolsBySession = groupBy(tools, (tool) => tool.session_id);
    const spansBySession = groupBy(spans, (span) => span.session_id);
    const result = [];

    for (const [sessionId, sessionSpans] of spansBySession) {
        sessionSpans.sort((a, b) => a.start_step_ordinal - b.start_step_ordinal);
        const sessionTools = (toolsBySession.get(sessionId) ?? [])
            .slice()
            .sort((a, b) => (a.step_ordinal ?? -1) - (b.step_ordinal ?? -1) || a.ordinal - b.ordinal);

        for (let index = 0; index < sessionSpans.length; index += 1) {
            const span = sessionSpans[index];
            const spanTools = sessionTools.filter((tool) => tool.step_ordinal !== null
                && tool.step_ordinal >= span.start_step_ordinal
                && tool.step_ordinal <= span.end_step_ordinal);
            const previous = settings.include_neighbor_activities ? sessionSpans[index - 1]?.primary_activity ?? null : null;
            const next = settings.include_neighbor_activities ? sessionSpans[index + 1]?.primary_activity ?? null : null;
            const fingerprint = buildOperationFingerprint(span, spanTools, {
                scope: sessionId === rootSessionId ? "main_agent" : "subagent",
                previous_primary_activity: previous,
                next_primary_activity: next,
                settings,
            });
            result.push({ ...span, operation_fingerprint: fingerprint });
        }
    }

    return result.sort((a, b) => a.root_session_id.localeCompare(b.root_session_id)
        || a.session_id.localeCompare(b.session_id)
        || a.start_step_ordinal - b.start_step_ordinal);
}

export function buildOperationFingerprint(span, tools, options) {
    const operations = tools.map(operationName);
    const collapsed = collapseSequence(operations, options.settings.tool_call_count_maxima);
    const operationCounts = countValues(operations);
    const containsWrite = tools.some(isWriteTool);
    const containsVerification = tools.some((tool) => (tool.operation_category ?? "").startsWith("verification."));
    const containsBuild = tools.some((tool) => (tool.operation_category ?? "").startsWith("build."));
    const mutationMode = resolveMutationMode(tools, containsWrite);
    const profile = {
        contains_write: containsWrite,
        mutation_mode: mutationMode,
        contains_verification: containsVerification,
        contains_build: containsBuild,
        contains_delegation: tools.some((tool) => tool.tool_category === "delegation"),
        contains_error: tools.some((tool) => tool.status === "error"),
    };
    // Only these fields define membership. All other observations remain
    // diagnostics so that harmless context differences do not split work.
    const signature = {
        scope: options.scope,
        primary_activity: span.primary_activity,
        collapsed_operation_sequence: collapsed,
        mutation_mode: mutationMode,
    };

    const signatureHash = sha256(signature);
    const { scope: _scope, ...structuralFamilySignature } = signature;
    const structuralFamilyHash = sha256(structuralFamilySignature);
    return {
        version: FINGERPRINT_VERSION,
        fingerprint_id: `fp-${signatureHash.slice(0, 16)}`,
        signature_hash: signatureHash,
        signature,
        structural_family_id: `family-${structuralFamilyHash.slice(0, 16)}`,
        structural_family_hash: structuralFamilyHash,
        operation_sequence: operations,
        collapsed_operation_sequence: collapsed,
        operation_counts: operationCounts,
        mutation_mode: mutationMode,
        diagnostics: {
            activities: [...span.activities].sort(),
            profile,
            step_count_bucket: bucket(span.step_count, options.settings.step_count_maxima),
            tool_call_count_bucket: bucket(span.tool_calls, options.settings.tool_call_count_maxima),
            output_size_bucket: bucketBigInt(span.output_bytes ?? 0n, options.settings.output_byte_maxima),
            previous_primary_activity: options.previous_primary_activity,
            next_primary_activity: options.next_primary_activity,
        },
        resource_key_counts: Object.fromEntries(Object.entries(aggregateResourceKeys(tools)).map(([key, values]) => [key, values.length])),
    };
}

function resolveMutationMode(tools, containsWrite) {
    if (containsWrite)
    { return "write"; }
    if (tools.length === 0)
    { return "unknown"; }
    if (tools.every(isReadOnlyTool))
    { return "read_only"; }
    return "unknown";
}

function isWriteTool(tool) {
    const operation = operationName(tool);
    return tool.tool_category === "write" || operation === "write" || operation.startsWith("file.write");
}

function isReadOnlyTool(tool) {
    const operation = operationName(tool);
    return ["read", "search", "web", "skill"].includes(tool.tool_category)
        || ["file.read", "repository.search", "external.web", "skill.load"].includes(operation)
        || operation.startsWith("verification.");
}

export function operationName(tool) {
    if (tool.operation_category)
    { return tool.operation_category; }
    const mapped = {
        search: "repository.search",
        read: "file.read",
        write: "file.write",
        web: "external.web",
        skill: "skill.load",
        delegation: "delegation.other",
        version_control: "version_control.other",
        shell: "shell.other",
    }[tool.tool_category];
    if (mapped)
    { return mapped; }
    return `tool.${tool.tool_name ?? "unknown"}`;
}

export function collapseSequence(values, maxima = DEFAULTS.tool_call_count_maxima) {
    if (values.length === 0)
    { return []; }
    const result = [];
    let current = values[0];
    let count = 0;
    const flush = () => {
        if (count === 1)
        { result.push(current); }
        else
        { result.push(`${current}{${bucket(count, maxima)}}`); }
    };
    for (const value of values) {
        if (value === current) {
            count += 1;
            continue;
        }
        flush();
        current = value;
        count = 1;
    }
    flush();
    return result;
}

export function aggregateResourceKeys(tools) {
    const result = { paths: new Set(), queries: new Set(), symbols: new Set(), commands: new Set() };
    for (const tool of tools) {
        for (const key of Object.keys(result)) {
            for (const value of tool.resource_keys?.[key] ?? [])
            { result[key].add(value); }
        }
    }
    return Object.fromEntries(Object.entries(result).map(([key, values]) => [key, [...values].sort()]));
}

function bucket(value, maxima) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0)
    { return "unknown"; }
    if (number === 0)
    { return "0"; }
    let lower = 1;
    for (const maximum of maxima) {
        if (number <= maximum)
        { return lower === maximum ? `${maximum}` : `${lower}-${maximum}`; }
        lower = maximum + 1;
    }
    return `${lower}+`;
}

function bucketBigInt(value, maxima) {
    if (value === null || value < 0n)
    { return "unknown"; }
    if (value === 0n)
    { return "0"; }
    let lower = 1n;
    for (const maximumValue of maxima) {
        const maximum = BigInt(maximumValue);
        if (value <= maximum)
        { return lower === maximum ? `${maximum}` : `${lower}-${maximum}`; }
        lower = maximum + 1n;
    }
    return `${lower}+`;
}

function countValues(values) {
    const result = {};
    for (const value of values)
    { result[value] = (result[value] ?? 0) + 1; }
    return result;
}

function groupBy(values, key) {
    const result = new Map();
    for (const value of values) {
        const groupKey = key(value);
        const group = result.get(groupKey) ?? [];
        group.push(value);
        result.set(groupKey, group);
    }
    return result;
}
