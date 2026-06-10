import {getActiveSectionNames} from "../patterns/section-activation.mjs";
import {hashJson} from "../shared/hashing.mjs";

export function assessRiskForFullFinalPass(activeSections, config) {
    const changedSections = getActiveSectionNames(activeSections)
        .filter((sectionName) => sectionName !== "ALWAYS_FULL" && sectionName !== "ALWAYS_ON_RERUN");
    const reasons = [];

    for (const section of changedSections) {
        if (config.sections[section]?.requiresFinalFullPass) {
            reasons.push(`section_requires_final_full_pass:${section}`);
        }
    }

    return {
        changedSections,
        reasons,
        shouldRunFullFinalPass: reasons.length > 0,
    };
}

export function includeSessionRiskForFullFinalPass(riskAssessment, session, config, mode) {
    const matrixChangedSinceLastFullPass = mode === "delta"
        && session.lastFullPass?.matrixHash
        && session.lastFullPass.matrixHash !== hashJson(config.raw);

    if (!matrixChangedSinceLastFullPass) {
        return riskAssessment;
    }

    return {
        ...riskAssessment,
        reasons: [
            ...new Set([
                ...riskAssessment.reasons,
                "matrix_changed_since_last_full_pass",
            ]),
        ],
        shouldRunFullFinalPass: true,
    };
}
