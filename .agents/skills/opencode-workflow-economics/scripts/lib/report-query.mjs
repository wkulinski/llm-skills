import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { buildReportIndex } from "./report-index.mjs";
import { buildOverlapDetail, buildPatternDetail, buildRootDetail, serializeReport } from "./report-files.mjs";
import { renderAnalysisBrief } from "./report-brief.mjs";

const DEFAULT_LIST_BYTES = 8 * 1024;
const DEFAULT_ROOT_BYTES = 16 * 1024;
const DEFAULT_ROOT_SPANS = 20;

export async function readReportBrief(analysisDir, options = {}) {
    const bundle = await readCanonicalReport(analysisDir);
    return renderAnalysisBrief(bundle, buildReportIndex(bundle), options);
}

export async function listReportItems(options) {
    const bundle = await readCanonicalReport(options.analysis_dir);
    const index = buildReportIndex(bundle);
    const type = normalizeType(options.type);
    const limit = options.limit ?? 20;
    let values;
    if (type === "patterns") { values = listPatterns(index, options); }
    else if (type === "overlaps") { values = listOverlaps(index, options); }
    else if (type === "roots") { values = listRoots(index, options); }
    else if (type === "subagents") { values = listSubagents(index); }
    else if (type === "models") { values = listModels(index); }
    else if (type === "activities") { values = listActivities(index); }
    else { throw new Error(`Unsupported list type: ${options.type}`); }
    const selected = values.slice(0, limit);
    const omitted = Math.max(0, (index.projection_counts?.[type] ?? values.length) - selected.length);
    if (options.json) { return `${JSON.stringify({items: selected, omitted}, null, 2)}\n`; }
    return fitOutput(renderList(type, selected, omitted), options.max_bytes ?? DEFAULT_LIST_BYTES, omitted);
}

export async function showReportItem(options) {
    const bundle = await readCanonicalReport(options.analysis_dir);
    const index = buildReportIndex(bundle);
    const type = singularType(options.type);
    const collection = type === "pattern" ? index.patterns : type === "overlap" ? index.overlaps : type === "root" ? index.roots : null;
    if (!collection) { throw new Error(`Unsupported show type: ${options.type}`); }
    const idField = type === "pattern" ? "pattern_id" : type === "overlap" ? "delegation_id" : "root_session_id";
    const entry = collection.find((item) => item[idField] === options.id);
    if (!entry) { throw new Error(`${type} not found: ${options.id}`); }
    const detail = detailFor(bundle, type, entry[idField]);
    if (options.json) { return serializeReport(detail); }
    if (type === "pattern") { return renderPattern(detail); }
    if (type === "overlap") { return renderOverlap(detail); }
    return renderRoot(detail, {
        max_bytes: options.max_bytes ?? DEFAULT_ROOT_BYTES,
        max_spans: options.max_spans ?? DEFAULT_ROOT_SPANS,
    });
}

async function readCanonicalReport(analysisDir) {
    const reportPath = resolve(analysisDir, "report.json");
    try {
        return JSON.parse(await readFile(reportPath, "utf8"));
    } catch (error) {
        if (error.code !== "ENOENT") { throw error; }
    }

    if (await hasLegacyLayout(analysisDir))
    { throw new Error("Legacy OWE report layout detected. Run `owe prepare` to regenerate the report."); }
    throw new Error(`OWE canonical report not found: ${reportPath}. Run 'prepare' first.`);
}

async function hasLegacyLayout(analysisDir) {
    for (const name of ["CURRENT", "generations", "index.json", "brief.md", "full-bundle.json", "patterns", "overlaps", "roots"]) {
        try {
            await access(resolve(analysisDir, name));
            return true;
        } catch (error) {
            if (error.code !== "ENOENT") { throw error; }
        }
    }
    return false;
}

function detailFor(bundle, type, id) {
    if (type === "pattern") {
        const pattern = bundle.pattern_groups.find((item) => item.pattern_id === id);
        return buildPatternDetail(bundle, pattern);
    }
    if (type === "overlap") {
        const diagnostic = bundle.delegation_overlap_diagnostics.find((item) => item.delegation_id === id);
        return buildOverlapDetail(bundle, diagnostic);
    }
    const root = bundle.roots.find((item) => item.root_session_id === id);
    return buildRootDetail(bundle, root);
}

function listPatterns(index, options) {
    const byId = new Map(index.patterns.map((item) => [item.pattern_id, item]));
    const view = options.view ? normalizeView(options.view) : null;
    if (view && !Object.hasOwn(index.pattern_views, view)) {
        throw new Error(`Unknown pattern view: ${options.view}. Available: ${Object.keys(index.pattern_views).join(", ")}`);
    }
    const values = view
        ? index.pattern_views[view].map((id) => byId.get(id)).filter(Boolean)
        : index.patterns.slice();
    const sort = options.sort ?? "total-cost";
    if (!["total-cost", "frequency", "median-cost"].includes(sort)) { throw new Error(`Unknown pattern sort: ${sort}`); }
    if (sort === "frequency") { values.sort((a, b) => b.occurrences - a.occurrences || b.distinct_root_sessions - a.distinct_root_sessions); }
    else if (sort === "median-cost") { values.sort((a, b) => compareNano(b.median_value_nano, a.median_value_nano)); }
    else { values.sort((a, b) => compareCost(b.total_cost, a.total_cost)); }
    return values;
}

function listOverlaps(index, options) {
    let values = index.overlaps.slice();
    if (options.diagnostic && !Object.hasOwn(index.overlap_views, options.diagnostic)) {
        throw new Error(`Unknown overlap diagnostic: ${options.diagnostic}. Available: ${Object.keys(index.overlap_views).join(", ")}`);
    }
    if (options.diagnostic) { values = values.filter((item) => item.diagnostic === options.diagnostic); }
    const priority = new Map([["strong_repeated_work_signal", 0], ["declared_read_context", 1], ["possible_repeated_work", 2], ["mixed_followup", 3], ["no_overlap_observed_in_window", 4], ["structural_overlap_only", 5], ["insufficient_evidence", 6]]);
    values.sort((a, b) => (priority.get(a.diagnostic) ?? 99) - (priority.get(b.diagnostic) ?? 99)
        || b.exact_resource_matches_before_first_write - a.exact_resource_matches_before_first_write
        || b.exact_resource_matches - a.exact_resource_matches);
    return values;
}

function listRoots(index, options) {
    const values = index.roots.slice();
    const sort = options.sort ?? "cost";
    if (!["cost", "created"].includes(sort)) { throw new Error(`Unknown root sort: ${sort}`); }
    if (sort === "created") { values.sort((a, b) => compareNano(b.created_at_ms, a.created_at_ms)); }
    else { values.sort((a, b) => compareCost(b.cost, a.cost)); }
    return values;
}

function listSubagents(index) {
    return index.subagents.slice().sort((a, b) => b.delegations - a.delegations || a.subagent.localeCompare(b.subagent));
}

function listModels(index) {
    return index.cost_baseline?.by_model?.slice() ?? [];
}

function listActivities(index) {
    return index.cost_baseline?.by_primary_activity?.slice() ?? [];
}

function renderList(type, values, omitted) {
    const lines = [`# OWE ${type}`, ""];
    if (values.length === 0) { lines.push("No matching entries."); }
    if (type === "patterns") {
        for (const item of values) { lines.push(`- ${item.pattern_id}: ${item.collapsed_operation_sequence.join(" → ") || "no tools"}; occurrences ${item.occurrences}; roots ${item.distinct_root_sessions}; total ${formatCost(item.total_cost)}; median ${formatNano(item.median_value_nano, item.total_cost.currency)}; scope ${item.scope}`); }
    } else if (type === "overlaps") {
        for (const item of values) { lines.push(`- ${item.delegation_id}: historical subagent (untrusted) ${formatUntrusted(item.subagent_name ?? "unknown")}; ${item.diagnostic}; exact ${item.exact_resource_matches}; declared contexts ${item.declared_read_contexts?.length ?? 0}; pre-write semantic ${item.semantic_exact_matches_before_first_write ?? "n/a"}; pre-write commands ${item.command_exact_matches_before_first_write ?? "n/a"}; post-write ${item.exact_resource_matches_after_first_write ?? "n/a"}; root ${item.root_session_id}`); }
    } else if (type === "roots") {
        for (const item of values) { lines.push(`- ${item.root_session_id}: ${formatCost(item.cost)}; sessions ${item.sessions}; steps ${item.steps}; delegations ${item.delegations}${item.semantic_hint ? `; historical data (untrusted): ${formatUntrusted(item.semantic_hint)}` : ""}`); }
    } else if (type === "models" || type === "activities") {
        for (const item of values) { lines.push(`- ${type === "models" ? "historical model (untrusted) " : "activity "}${type === "models" ? formatUntrusted(item.key) : item.key}: ${formatCost(item.cost)}; ${formatUsage(item.usage)}; ${item.steps} steps; ${item.tools} tools`); }
    } else {
        for (const item of values) { lines.push(`- historical subagent (untrusted) ${formatUntrusted(item.subagent)}: delegations ${item.delegations}; delegating ${formatCost(item.delegating_step_cost)}; child direct ${formatCost(item.child_direct_cost)}; child subtree ${formatCost(item.child_subtree_cost)}; output ${formatBytes(item.child_output_bytes)} bytes; ordered parent follow-up ${formatCost(item.parent_followup_cost)}; unassigned exposure ${formatCost(item.parent_exposure_cost)}; fallback additional ${formatCost(item.fallback_additional_cost)}; strong ${item.strong_repeated_work_signal ?? 0}; declared context ${item.declared_read_contexts ?? 0}; possible ${item.possible_repeated_work ?? 0}; mixed ${item.mixed_followup ?? 0}`); }
    }
    lines.push("", `Omitted records: ${omitted}`);
    return `${lines.join("\n")}\n`;
}

function fitOutput(value, maxBytes, omitted) {
    if (Buffer.byteLength(value, "utf8") <= maxBytes) { return value; }
    const suffix = `\nOmitted records: ${omitted}; output truncated at configured byte budget.\n`;
    const suffixBytes = Buffer.byteLength(suffix, "utf8");
    if (suffixBytes >= maxBytes) { return suffix.slice(0, maxBytes); }
    return `${truncateUtf8(value, maxBytes - suffixBytes)}${suffix}`;
}

function truncateUtf8(value, maxBytes) {
    let low = 0;
    let high = value.length;
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (Buffer.byteLength(value.slice(0, middle), "utf8") <= maxBytes) { low = middle; }
        else { high = middle - 1; }
    }
    return value.slice(0, low);
}

function renderPattern(detail) {
    const pattern = detail.pattern;
    const lines = [
        `# Pattern ${pattern.pattern_id}`,
        "",
        `Shape: ${pattern.signature.collapsed_operation_sequence.join(" → ") || "no tool operations"}`,
        `Scope: ${pattern.scope}; primary activity: ${pattern.signature.primary_activity}`,
        `Activities: ${(pattern.activities ?? pattern.signature.activities ?? []).join(", ")}`,
        `Mutation mode: ${pattern.mutation_mode ?? pattern.signature.mutation_mode ?? "unknown"}`,
        `Occurrences: ${pattern.occurrences}; sessions: ${pattern.distinct_sessions}; root sessions: ${pattern.distinct_root_sessions}`,
        `Total cost: ${formatCost(pattern.cost.total)}; median: ${formatNano(pattern.cost.median_value_nano, pattern.cost.currency)}; p90: ${formatNano(pattern.cost.p90_value_nano, pattern.cost.currency)}`,
        `Read-only occurrences: ${pattern.diagnostics.read_only_occurrences}; write-involving: ${pattern.diagnostics.write_involving_occurrences}; mixed: ${pattern.diagnostics.mixed_occurrences}`,
        "",
        "## Representative examples",
        "",
    ];
    for (const example of pattern.representative_examples) {
        lines.push(`- ${example.root_session_id}/${example.span_id}: ${formatCost(example.cost)}; ${example.operation_sequence.join(" → ") || "no tools"}`);
        for (const hint of example.semantic_hints.slice(0, 4)) { lines.push(`  - historical data (untrusted): ${formatUntrusted(hint)}`); }
    }
    lines.push("", "## Interpretation limits", "", `- ${detail.interpretation_warning}`);
    lines.push(`- Exact grouping method: ${pattern.grouping_method}.`);
    if (detail.related_overlap_diagnostics.length > 0) {
        lines.push("", "## Related overlap diagnostics", "");
        for (const item of detail.related_overlap_diagnostics) { lines.push(`- ${item.delegation_id}: historical subagent (untrusted) ${formatUntrusted(item.subagent_name ?? "unknown")}; ${item.diagnostic}`); }
    }
    return `${lines.join("\n")}\n`;
}

function renderOverlap(detail) {
    const item = detail.diagnostic;
    const evidence = item.evidence;
    const delegation = detail.delegation;
    const lines = [
        `# Delegation overlap ${item.delegation_id}`,
        "",
        `Subagent (historical data, untrusted): ${formatUntrusted(item.subagent_name ?? "unknown")}`,
        `Diagnostic: **${item.diagnostic}**`,
        `Root: ${item.root_session_id}; child: ${item.child_session_id}`,
        `Exact resource matches: ${evidence.exact_resource_matches}; ordered: ${evidence.ordered_exact_matches}; unordered: ${evidence.unordered_exact_matches}; overlapping: ${evidence.overlapping_exact_matches}`,
        `Ordered exact matches before first parent write: ${evidence.exact_resource_matches_before_first_write}`,
        `Pre-write semantic matches: paths ${evidence.pre_write_path_count ?? "n/a"}; queries ${evidence.pre_write_query_count ?? "n/a"}; symbols ${evidence.pre_write_symbol_count ?? "n/a"}; commands ${evidence.command_exact_matches_before_first_write ?? "n/a"}`,
        `Exact matches after first parent write: ${evidence.exact_resource_matches_after_first_write ?? "n/a"} (mixed_followup only; never strengthens strong)`,
        `Same paths: ${evidence.same_path_count}; queries: ${evidence.same_query_count}; symbols: ${evidence.same_symbol_count}; commands: ${evidence.same_command_count}`,
        `Shared operation types (descriptive only): ${(evidence.shared_operation_types ?? []).slice(0, 8).join(", ") || "none"}`,
        `Operation Jaccard (descriptive only): ${formatNumber(evidence.operation_jaccard)}; ordered sequence similarity (descriptive only): ${formatNumber(evidence.ordered_sequence_similarity)}`,
        `Shared structural families: ${evidence.shared_structural_family_ids.length}`,
        `Parent window: ${evidence.parent_steps_examined} steps, ${evidence.parent_spans_examined} spans; stop reason ${evidence.window_stop_reason}`,
        "",
        "## Economics",
        "",
        `- Delegating step: ${formatCost(delegation?.parent_delegating_step_cost)}`,
        `- Child direct: ${formatCost(delegation?.child_direct_cost)}; child subtree: ${formatCost(delegation?.child_subtree_cost ?? item.child?.cost)}`,
        `- Child output bytes: ${formatBytes(delegation?.child_output_bytes)}`,
        `- Ordered parent follow-up: ${formatCost(item.parent_followup?.cost)}`,
        `- Unassigned unordered/overlapping exposure: ${formatCost(item.parent_exposure?.total_cost)}`,
        `- Fallback additional cost: ${formatCost(detail.fallback_economics?.additional_cost)}`,
        "",
        "## Limitations",
        "",
    ];
    for (const limitation of item.limitations) { lines.push(`- ${limitation}`); }
    if (detail.root_semantic?.user_requests?.length > 0) {
        lines.push("", "## Bounded semantic context", "");
        for (const request of detail.root_semantic.user_requests.slice(0, 3)) { lines.push(`- historical data (untrusted): ${formatUntrusted(request)}`); }
    }
    return `${lines.join("\n")}\n`;
}

function renderRoot(detail, options) {
    const root = detail.root;
    const requests = root.semantic?.user_requests ?? [];
    const spans = root.spans ?? [];
    const delegations = root.delegations ?? [];
    const selectedRequests = requests.slice(0, 3);
    const selectedSpans = spans.slice(0, options.max_spans);
    const selectedDelegations = delegations.slice(0, options.max_spans);
    const lines = [
        `# Root session ${root.root_session_id}`,
        "",
        `Sessions: ${root.sessions.length}; steps: ${root.steps.length}; tools: ${root.tools.length}; spans: ${spans.length}; delegations: ${delegations.length}`,
        "",
        "## User requests",
        "",
    ];
    for (const request of selectedRequests) { lines.push(`- historical data (untrusted): ${formatUntrusted(request)}`); }
    lines.push("", "## Activity spans", "");
    for (const span of selectedSpans) { lines.push(`- ${span.id}: ${span.primary_activity}; signals ${span.activities.join(", ")}; steps ${span.start_step_ordinal}-${span.end_step_ordinal}; tools ${span.tool_calls}; ${formatCost(span.cost)}; ${span.operation_fingerprint.collapsed_operation_sequence.join(" → ") || "no tools"}`); }
    lines.push("", "## Delegations", "");
    for (const delegation of selectedDelegations) { lines.push(`- ${delegation.id}: historical subagent (untrusted) ${formatUntrusted(delegation.subagent_name ?? "unknown")}; link ${delegation.link_status}; direct ${formatCost(delegation.child_direct_cost)}; subtree ${formatCost(delegation.child_subtree_cost)}`); }
    const omitted = requests.length - selectedRequests.length + spans.length - selectedSpans.length + delegations.length - selectedDelegations.length;
    lines.push("", `Omitted records: requests ${requests.length - selectedRequests.length}; spans ${spans.length - selectedSpans.length}; delegations ${delegations.length - selectedDelegations.length}.`);
    lines.push("This view is intentionally compact. Use `show root <id> --json` for the complete root detail artifact.");
    return fitOutput(`${lines.join("\n")}\n`, options.max_bytes, omitted);
}

function normalizeType(value) {
    if (["pattern", "patterns"].includes(value)) { return "patterns"; }
    if (["overlap", "overlaps"].includes(value)) { return "overlaps"; }
    if (["root", "roots", "session", "sessions"].includes(value)) { return "roots"; }
    if (["subagent", "subagents"].includes(value)) { return "subagents"; }
    if (["model", "models"].includes(value)) { return "models"; }
    if (["activity", "activities"].includes(value)) { return "activities"; }
    return value;
}

function singularType(value) {
    const normalized = normalizeType(value);
    return normalized === "patterns" ? "pattern" : normalized === "overlaps" ? "overlap" : normalized === "roots" ? "root" : normalized;
}

function normalizeView(value) {
    return value.replaceAll("-", "_");
}

function compareCost(left, right) {
    return compareNano(left?.value_nano ?? left?.priced_value_nano, right?.value_nano ?? right?.priced_value_nano);
}

function compareNano(left, right) {
    const a = left === null || left === undefined ? -1n : BigInt(left);
    const b = right === null || right === undefined ? -1n : BigInt(right);
    return a === b ? 0 : a > b ? 1 : -1;
}

function formatCost(cost) {
    if (!cost) { return "n/a"; }
    const value = cost.value_nano ?? cost.priced_value_nano;
    const coverage = `${cost.priced_steps}/${cost.eligible_steps} steps`;
    if (cost.status === "complete") { return `${formatNano(value, cost.currency)} (complete, ${coverage})`; }
    return `priced part ${formatNano(value, cost.currency)} (${cost.status}, ${coverage})`;
}

function formatUsage(usage) {
    if (!usage) { return "usage n/a"; }
    return `usage input ${formatInteger(usage.input_tokens)} output ${formatInteger(usage.output_tokens)} reasoning ${formatInteger(usage.reasoning_tokens)}`;
}

function formatInteger(value) {
    return value === null || value === undefined ? "n/a" : value.toString();
}

function formatBytes(value) {
    return value === null || value === undefined ? "n/a" : value.toString();
}

function formatNano(value, currency) {
    if (value === null || value === undefined) { return `n/a ${currency ?? ""}`.trim(); }
    const bigint = BigInt(value);
    const whole = bigint / 1000000000n;
    const fraction = (bigint % 1000000000n).toString().padStart(9, "0").replace(/0+$/, "");
    return `${fraction ? `${whole}.${fraction}` : whole.toString()} ${currency ?? ""}`.trim();
}

function formatNumber(value) {
    return value === null || value === undefined ? "n/a" : value.toFixed(3);
}

function oneLine(value) {
    return value.replace(/\s+/g, " ").trim();
}

function formatUntrusted(value) {
    return `\`${oneLine(value).replaceAll("`", "'")}\``;
}
