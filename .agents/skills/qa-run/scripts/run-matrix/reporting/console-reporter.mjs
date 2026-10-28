import {getActiveSectionNames} from "../patterns/section-activation.mjs";

// Console output is agent context: short status lines only. Full commands and output stay in artifacts.
export function printCommandResult(commandResult, outputConfig) {
    const name = formatCommandName(commandResult);
    const durationSeconds = formatSeconds(commandResult.durationMs);
    if (commandResult.status === "SKIP-CACHED") {
        console.log(`SKIP-CACHED ${name} previous_pass=${commandResult.cache.previousPassedAt}`);
        return;
    }

    if (commandResult.status === "PASS") {
        console.log(`PASS ${name} ${durationSeconds}s`);
        return;
    }

    console.error(`${commandResult.status} ${name} exit=${commandResult.exitCode} ${durationSeconds}s`);
    if (commandResult.stdoutLog || commandResult.stderrLog) {
        console.error(`Logs: stdout=${commandResult.stdoutLog} stderr=${commandResult.stderrLog}`);
    }

    if (commandResult.error) {
        console.error(`Error: ${commandResult.error}`);
    }

    if (outputConfig.outputMode !== "silent" && commandResult.summary.length > 0) {
        console.error("Failure summary:");
        for (const line of commandResult.summary) {
            console.error(`- ${line}`);
        }
    }
}

export function printDetectedChanges(mode, rerunReason, files, activeSections) {
    const active = getActiveSectionNames(activeSections);
    console.log(
        `Detected: mode=${mode} rerun_reason=${rerunReason} files=${files.length} active=${active.length > 0 ? active.join(",") : "none"}`
    );
}

export function printConfigNotices(configNotices) {
    if (configNotices.length === 0) {
        return;
    }

    console.log("Config notices:");
    for (const notice of configNotices) {
        console.log(`NOTICE [${notice.section}] ${notice.message}`);
    }
}

/**
 * One result line built from the persisted summary; failures go to stderr.
 */
export function printRunResult(summary, artifacts) {
    const cached = summary.commands.filter((command) => command.status === "SKIP-CACHED").length;
    const durationMs = summary.commands.reduce((total, command) => total + (command.durationMs ?? 0), 0);
    const evidence = summary.evidence?.current === false ? "stale" : "current";
    const parts = [
        `QA: ${summary.status}`,
        `scope=${summary.scope}`,
        `evidence=${evidence}`,
        `commands=${summary.commands.length}`,
        `cached=${cached}`,
        `duration=${formatSeconds(durationMs)}s`,
        `artifacts=${artifacts.relativeDir}`,
    ];
    const write = summary.status === "PASS" ? console.log : console.error;
    write(parts.join(" "));

    for (const failure of summary.failures) {
        write(`Failed: ${formatCommandName(failure)} exit=${failure.exitCode}`);
    }

    if (summary.scope !== "full") {
        write(`NOTE: scope=${summary.scope} is not full QA.`);
    }
}

export function printRiskSummary(riskAssessment) {
    console.log(
        `Risk: changed_sections=${joinOrNone(riskAssessment.changedSections)} pending_final_full_pass=${riskAssessment.shouldRunFullFinalPass ? 1 : 0}`
    );
}

export function printSessionSummary(session) {
    console.log(
        `Session: pending_final_full_pass=${session.pendingFinalFullPass ? 1 : 0} reasons=${joinOrNone(session.pendingReasons)}`
    );
}

export function formatCommandName(commandResult) {
    return commandResult.label
        ? `[${commandResult.section}] ${commandResult.label}`
        : `[${commandResult.section}]`;
}

function formatSeconds(durationMs) {
    return ((durationMs ?? 0) / 1000).toFixed(1);
}

function joinOrNone(values) {
    return values.length > 0 ? values.join(",") : "none";
}
