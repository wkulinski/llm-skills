import {writeFileSync} from "node:fs";

import {getActiveSectionNames} from "../patterns/section-activation.mjs";
import {hashJson} from "../shared/hashing.mjs";

export function buildRunSummary({
    activeSections,
    artifacts,
    cli,
    commands,
    config,
    configNotices,
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
        failures,
        matrixHash: hashJson(config.raw),
        mode,
        pendingFinalFullPass: session.pendingFinalFullPass,
        pendingFinalFullPassReasons: session.pendingReasons ?? [],
        rerunReason: cli.rerunReason,
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
    writeFileSync(artifacts.summaryJsonAbs, `${JSON.stringify(summary, null, 2)}\n`, "utf-8");
    writeFileSync(artifacts.summaryTxtAbs, renderSummaryText(summary), "utf-8");
}

export function renderSummaryText(summary) {
    const cachedCommands = summary.commands.filter((command) => command.status === "SKIP-CACHED").length;
    const executedCommands = summary.commands.length - cachedCommands;
    const lines = [
        `QA: ${summary.status}`,
        `Mode: ${summary.mode}`,
        `Rerun reason: ${summary.rerunReason}`,
        `Commands: ${summary.commands.length} total / ${executedCommands} executed / ${cachedCommands} cached`,
        `Active sections: ${summary.activeSections.length}`,
        `Artifacts: ${summary.artifactsDir}`,
        `Pending final full pass: ${summary.pendingFinalFullPass ? "yes" : "no"}`,
    ];

    if (summary.failures.length === 0) {
        lines.push("Failures: none");
    } else {
        lines.push("Failures:");
        for (const failure of summary.failures) {
            lines.push(`- [${failure.section}] ${failure.command} exit=${failure.exitCode}`);
            for (const detail of failure.summary) {
                lines.push(`  - ${detail}`);
            }
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
