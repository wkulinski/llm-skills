import { chmod, mkdir, readdir, rm, rename, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { buildReportIndex } from "./report-index.mjs";
import { renderAnalysisBrief } from "./report-brief.mjs";
import { toSnakeCase } from "./util.mjs";

const REPORT_FILE = "report.json";
const TEMP_REPORT_PATTERN = /^\.report\.[^.]+\.[A-Za-z0-9-]+\.tmp$/;

/**
 * Publish the complete report as one canonical artifact.
 *
 * The historic function name is kept for callers from the earlier persistence
 * implementation. The implementation intentionally has no generations,
 * pointer, lock, retention or detail-file protocol.
 */
export async function writeLayeredReport(bundle, options = {}) {
    const analysisDir = resolve(options.analysis_dir);
    const reportPath = resolve(analysisDir, REPORT_FILE);
    const report = serializeReport(bundle);
    const index = buildReportIndex(bundle, { report_file: REPORT_FILE }, {
        report_bytes: Buffer.byteLength(report, "utf8"),
    });
    const brief = renderAnalysisBrief(bundle, index, options.brief ?? {});
    const temporary = resolve(analysisDir, `.report.${process.pid}.${randomUUID().slice(0, 12)}.tmp`);

    await mkdir(analysisDir, { recursive: true, mode: 0o700 });
    await chmod(analysisDir, 0o700);
    await cleanupTemporaryReports(analysisDir);

    try {
        await writeFile(temporary, report, { mode: 0o600 });
        await chmod(temporary, 0o600);
        await rename(temporary, reportPath);
        await chmod(reportPath, 0o600);
        await cleanupLegacyLayout(analysisDir);

        const reportBytes = Buffer.byteLength(report, "utf8");
        const briefBytes = Buffer.byteLength(brief, "utf8");
        return {
            analysis_dir: analysisDir,
            report_path: reportPath,
            report_sizes: {
                report_bytes: reportBytes,
                brief_bytes: briefBytes,
                estimated_report_tokens: Math.ceil(reportBytes / 4),
                estimated_brief_tokens: Math.ceil(briefBytes / 4),
                token_estimation_method: "ceil(utf8_bytes/4)",
            },
            detail_counts: {
                patterns: bundle.pattern_groups.length,
                overlaps: bundle.delegation_overlap_diagnostics.length,
                roots: bundle.roots.length,
            },
        };
    } finally {
        await rm(temporary, { force: true });
    }
}

export async function writeUnavailableReport(options = {}) {
    const analysisDir = resolve(options.analysis_dir);
    const reportPath = resolve(analysisDir, REPORT_FILE);
    const report = `${JSON.stringify({
        artifact_type: "owe_report",
        schema_version: 1,
        status: "COST_UNAVAILABLE",
        generated_at: new Date().toISOString(),
        analysis_dir: analysisDir,
        reason: options.reason ?? "OpenCode session collection failed",
        phase: options.phase ?? "collection",
        requested_sessions: options.requested_sessions ?? [],
        retryable: options.retryable ?? true,
    }, null, 2)}\n`;
    const temporary = resolve(analysisDir, `.report-unavailable.${process.pid}.${randomUUID().slice(0, 12)}.tmp`);
    await mkdir(analysisDir, {recursive: true, mode: 0o700});
    await chmod(analysisDir, 0o700);
    try {
        await writeFile(temporary, report, {mode: 0o600});
        await chmod(temporary, 0o600);
        await rename(temporary, reportPath);
        await chmod(reportPath, 0o600);
        return {analysis_dir: analysisDir, report_path: reportPath, status: "COST_UNAVAILABLE"};
    } finally {
        await rm(temporary, {force: true});
    }
}

export function serializeReport(value) {
    return `${JSON.stringify(toSnakeCase(value), null, 2)}\n`;
}

export function buildPatternDetail(bundle, pattern) {
    const spanById = new Map(bundle.roots.flatMap((root) => root.spans).map((span) => [span.id, span]));
    const occurrences = pattern.span_ids.map((id) => spanById.get(id)).filter(Boolean);
    const relatedOverlaps = bundle.delegation_overlap_diagnostics.filter((item) => {
        const families = new Set(item.evidence?.shared_structural_family_ids ?? []);
        return families.has(pattern.structural_family_id);
    }).map((item) => ({
        delegation_id: item.delegation_id,
        subagent_name: item.subagent_name,
        diagnostic: item.diagnostic,
    }));
    const interpretationWarnings = [
        "This is a deterministic structural group, not a semantic task class.",
    ];
    if ((pattern.distinct_root_sessions ?? 0) < 2) {
        interpretationWarnings.push("This pattern was observed in one root session; do not treat it as a stable delegation class.");
    }
    return {
        artifact_type: "owe_pattern_detail",
        schema_version: 1,
        generated_at: bundle.generated_at,
        interpretation_warning: interpretationWarnings.join(" "),
        pattern,
        occurrences,
        occurrences_truncated: pattern.span_ids_truncated ?? 0,
        related_overlap_diagnostics: relatedOverlaps,
    };
}

export function buildOverlapDetail(bundle, diagnostic) {
    const root = bundle.roots.find((item) => item.root_session_id === diagnostic.root_session_id) ?? null;
    const delegation = root?.delegations.find((item) => item.id === diagnostic.delegation_id) ?? null;
    const fallback = bundle.aggregates.delegation_economics?.fallback_attempts
        ?.find((item) => item.fallback_delegation_id === diagnostic.delegation_id) ?? null;
    return {
        artifact_type: "owe_overlap_detail",
        schema_version: 1,
        generated_at: bundle.generated_at,
        interpretation_warning: "Overlap is diagnostic evidence. Strong repeated-work signals require ordered exact path/query/symbol intersections before the parent's first write; command matches are weaker, and post-write exact matches are mixed follow-up only. Declared read context is workflow metadata, not proof of freshness or non-redundancy. Only ordered post-child evidence contributes to repeated-work labels and follow-up cost; unordered or overlapping reads may be deliberate verification rather than wasted work.",
        diagnostic,
        delegation,
        fallback_economics: fallback,
        root_semantic: root?.semantic ?? null,
    };
}

export function buildRootDetail(bundle, root) {
    return {
        artifact_type: "owe_root_detail",
        schema_version: 1,
        generated_at: bundle.generated_at,
        root,
    };
}

async function cleanupTemporaryReports(analysisDir) {
    let entries;
    try {
        entries = await readdir(analysisDir, { withFileTypes: true });
    } catch (error) {
        if (error.code === "ENOENT") { return; }
        throw error;
    }
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const entry of entries) {
        if (!entry.isFile() || !TEMP_REPORT_PATTERN.test(entry.name)) { continue; }
        const path = resolve(analysisDir, entry.name);
        const details = await stat(path);
        if (details.mtimeMs < cutoff) { await rm(path, { force: true }); }
    }
}

async function cleanupLegacyLayout(analysisDir) {
    for (const name of [
        "CURRENT",
        "LOCK",
        ".staging",
        "generations",
        "brief.md",
        "index.json",
        "full-bundle.json",
        "patterns",
        "overlaps",
        "roots",
    ]) {
        await rm(resolve(analysisDir, name), { recursive: true, force: true });
    }
}
