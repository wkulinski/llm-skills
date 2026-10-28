import {writeFileSync} from "node:fs";

import {getActiveSectionNames} from "../patterns/section-activation.mjs";
import {formatCommandName} from "./console-reporter.mjs";
import {hashJson} from "../shared/hashing.mjs";

export function buildRunSummary({
    activeSections,
    artifacts,
    cli,
    commands,
    config,
    configNotices,
    evidence = null,
    failures,
    files,
    mode,
    riskAssessment,
    session,
    skippedNoChanges,
    skippedNoCommands,
    status,
}) {
    return {
        activeSections: getActiveSectionNames(activeSections),
        artifactsDir: artifacts.relativeDir,
        changedFilesCount: files.length,
        changedFilesHash: hashJson(files),
        commands,
        completedAt: new Date().toISOString(),
        configNotices,
        evidence: evidence
            ? {
                current: evidence.evidenceCurrent,
                inputSnapshotHash: evidence.snapshotHash,
                inputsMutated: evidence.inputsMutated,
                postRunSnapshotHash: evidence.postRunSnapshotHash,
            }
            : null,
        failures,
        matrixHash: hashJson(config.raw),
        mode,
        pendingFinalFullPass: session.pendingFinalFullPass,
        pendingFinalFullPassReasons: session.pendingReasons ?? [],
        rerunReason: cli.rerunReason,
        scope: cli.scope ?? "full",
        selection: evidence?.selection ?? null,
        riskAssessment: riskAssessment
            ? {
                changedSections: riskAssessment.changedSections,
                pendingFinalFullPass: riskAssessment.shouldRunFullFinalPass,
                pendingFinalFullPassReasons: riskAssessment.reasons,
            }
            : null,
        skippedNoChanges,
        skippedNoCommands,
        status,
    };
}

export function writeRunSummary(artifacts, summary) {
    writeFileSync(artifacts.summaryJsonAbs, `${JSON.stringify(summary, null, 2)}\n`, {encoding: "utf-8", mode: 0o600});
    writeFileSync(artifacts.summaryTxtAbs, renderSummaryText(summary), {encoding: "utf-8", mode: 0o600});
}

export function renderSummaryText(summary) {
    const cachedCommands = summary.commands.filter((command) => command.status === "SKIP-CACHED").length;
    const executedCommands = summary.commands.length - cachedCommands;
    const lines = [
        `QA: ${summary.status}`,
        `Scope: ${summary.scope ?? "full"}${(summary.scope ?? "full") === "full" ? "" : " (not full QA)"}`,
        `Mode: ${summary.mode}`,
        `Rerun reason: ${summary.rerunReason}`,
        `Commands: ${summary.commands.length} total / ${executedCommands} executed / ${cachedCommands} cached`,
        `Active sections: ${summary.activeSections.length}`,
        `Artifacts: ${summary.artifactsDir}`,
        `Pending final full pass: ${summary.pendingFinalFullPass ? "yes" : "no"}`,
    ];

    if (summary.evidence) {
        lines.push(summary.evidence.current
            ? "Evidence: current"
            : "Evidence: stale (working tree changed during QA)");
    }

    if (summary.failures.length === 0) {
        lines.push("Failures: none");
    } else {
        lines.push("Failures:");
        for (const failure of summary.failures) {
            appendFailureLines(lines, failure);
        }
    }

    if (summary.configNotices.length > 0) {
        lines.push("Config notices:");
        for (const notice of summary.configNotices) {
            lines.push(`- [${notice.section}] ${notice.message}`);
        }
    }

    lines.push("");
    return `${lines.join("\n")}\n`;
}

function appendFailureLines(lines, failure) {
    const name = failure.label === void 0 ? `[${failure.section}] ${failure.command}` : formatCommandName(failure);
    lines.push(`- ${name} exit=${failure.exitCode}`);
    if (failure.stdoutLog || failure.stderrLog) {
        lines.push(`  logs: stdout=${failure.stdoutLog} stderr=${failure.stderrLog}`);
    }
    lines.push(...failure.summary.map((detail) => `  - ${detail}`));
}
