export function printCommandResult(commandResult, outputConfig) {
    const durationSeconds = (commandResult.durationMs / 1000).toFixed(1);
    const logInfo = `stdout=${commandResult.stdoutLog} stderr=${commandResult.stderrLog}`;
    if (commandResult.status === "SKIP-CACHED") {
        console.log(
            `SKIP-CACHED [${commandResult.section}] ${commandResult.command} previous_pass=${commandResult.cache.previousPassedAt} ${logInfo}`
        );
        return;
    }

    if (commandResult.status === "PASS") {
        console.log(`PASS [${commandResult.section}] ${commandResult.command} duration=${durationSeconds}s ${logInfo}`);
        return;
    }

    console.error(
        `${commandResult.status} [${commandResult.section}] ${commandResult.command} exit=${commandResult.exitCode} duration=${durationSeconds}s ${logInfo}`
    );

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

export function printDetectedChanges(mode, rerunReason, files, activeSections, config, snapshotAbsPath = null, artifacts = null) {
    console.log("Detected changes:");
    console.log(`- mode=${mode}`);
    console.log(`- rerun_reason=${rerunReason}`);
    if (artifacts) {
        console.log(`- artifacts=${artifacts.relativeDir}`);
    }
    if (snapshotAbsPath) {
        console.log(`- delta_from_snapshot=${snapshotAbsPath}`);
    }
    console.log(`- files_count=${files.length}`);
    for (const section of config.sectionOrder) {
        console.log(`- ${section}=${activeSections[section] ? 1 : 0}`);
    }
}

export function printConfigNotices(configNotices) {
    if (configNotices.length === 0) {
        return;
    }

    console.log("\nConfig notices:");
    for (const notice of configNotices) {
        console.log(`NOTICE [${notice.section}] ${notice.message}`);
    }
}

export function printSummary(executed, skippedNoChanges, skippedNoCommands, artifacts) {
    const cachedCommands = executed.filter((command) => command.status === "SKIP-CACHED").length;
    const executedCommands = executed.length - cachedCommands;
    console.log("\nSummary:");
    console.log(`- commands_total=${executed.length}`);
    console.log(`- executed_commands=${executedCommands}`);
    console.log(`- cached_commands=${cachedCommands}`);
    console.log(
        `- skipped_no_changes=${skippedNoChanges.length > 0 ? skippedNoChanges.join(", ") : "none"}`
    );
    console.log(
        `- skipped_no_commands=${skippedNoCommands.length > 0 ? skippedNoCommands.join(", ") : "none"}`
    );

    if (executed.length === 0) {
        console.log("Result: no commands executed.");
    } else {
        console.log("Result: all commands passed or were skipped by cache.");
    }
    console.log(`- artifacts=${artifacts.relativeDir}`);
    console.log(`- summary_json=${artifacts.summaryJson}`);
}

export function printRiskSummary(riskAssessment) {
    console.log("\nRisk evaluation:");
    console.log(
        `- changed_sections=${riskAssessment.changedSections.length > 0 ? riskAssessment.changedSections.join(", ") : "none"}`
    );
    console.log(
        `- pending_final_full_pass=${riskAssessment.shouldRunFullFinalPass ? 1 : 0}`
    );
    console.log(
        `- pending_final_full_pass_reasons=${riskAssessment.reasons.length > 0 ? riskAssessment.reasons.join(", ") : "none"}`
    );
}

export function printSessionSummary(session) {
    console.log("\nSession:");
    console.log(`- pending_final_full_pass=${session.pendingFinalFullPass ? 1 : 0}`);
    console.log(
        `- pending_final_full_pass_reasons=${session.pendingReasons.length > 0 ? session.pendingReasons.join(", ") : "none"}`
    );
}
