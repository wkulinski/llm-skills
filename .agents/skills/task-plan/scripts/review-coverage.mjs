/** Structured coverage of an independent full plan review. Claims remain semantic inputs. */
export const PLAN_REVIEW_AREAS = Object.freeze([
    "source_coverage",
    "scope_justification",
    "critical_assumptions",
    "wp_dependencies",
    "execution_verification",
]);

const OUTCOMES = new Set(["REVIEWED", "FINDING", "NOT_RELEVANT", "NOT_COVERED"]);
const text = value => typeof value === "string" && value.trim().length > 0;

/** Validate declarations, never infer that an evidence reference proves the claim. */
export function validatePlanReviewCoverage(coverage, verdict) {
    const errors = [];
    const issue = (code, message) => errors.push({code, message});
    if (!Array.isArray(coverage) || coverage.length === 0) {
        return [{code: "REVIEW_COVERAGE_REQUIRED", message: "Full independent review requires structured coverage."}];
    }
    for (const area of PLAN_REVIEW_AREAS) {
        if (!coverage.some(row => row?.area === area)) {
            issue("REVIEW_COVERAGE_AREA_MISSING", `Missing coverage area: ${area}.`);
        }
    }
    for (const [index, row] of coverage.entries()) {
        if (!row || typeof row !== "object" || Array.isArray(row)) {
            issue("INVALID_REVIEW_COVERAGE", `Coverage row ${index} must be an object.`);
            continue;
        }
        if (!PLAN_REVIEW_AREAS.includes(row.area) || !OUTCOMES.has(row.outcome) || !text(row.subject)
            || !Array.isArray(row.evidence) || row.evidence.some(value => !text(value))) {
            issue("INVALID_REVIEW_COVERAGE", `Coverage row ${index} requires an area, subject, outcome and evidence array.`);
        }
        if (["REVIEWED", "FINDING"].includes(row.outcome) && (!text(row.scenario) || !row.evidence?.length)) {
            issue("REVIEW_COVERAGE_EVIDENCE_REQUIRED", `Coverage row ${index} requires a checked scenario and evidence.`);
        }
        if (row.outcome === "NOT_RELEVANT" && !text(row.reason)) {
            issue("REVIEW_COVERAGE_REASON_REQUIRED", `Coverage row ${index} requires an omission reason.`);
        }
        if (row.outcome === "NOT_COVERED" && (!text(row.gap) || typeof row.material !== "boolean")) {
            issue("REVIEW_COVERAGE_GAP_REQUIRED", `Coverage row ${index} requires a named gap and explicit material boolean.`);
        }
        if (row.outcome !== "NOT_COVERED" && typeof row.gap !== "undefined" && row.gap !== null) {
            issue("REVIEW_COVERAGE_GAP_CONFLICT", `Coverage row ${index} with a gap must be NOT_COVERED.`);
        }
        if (row.outcome === "NOT_COVERED" && row.material === true
            && ["PLAN READY", "PLAN READY WITH CAVEAT"].includes(verdict)) {
            issue("REVIEW_COVERAGE_VERDICT_CONFLICT", "A material coverage gap requires PLAN DISCUSS or a blocking verdict.");
        }
    }
    return errors;
}
