import {spawnSync} from "node:child_process";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";
import {draftReviewReport, validateReviewReport} from "../../../.agents/skills/_shared/scripts/review-report.mjs";

const codeTarget = {target: "code"};
const planTarget = {target: "plan"};
const CLEAN_REPORT = `No findings.

### Target

- **Type:** code
- **Artifact and revision:** PR at commit abc123.
- **Scope:** The changed save and read paths.
- **Requirements:** Saved data is visible only to its owner.

### Coverage

- REVIEWED — traced isolation from the query handler to the tenant database.
- **Omitted axes:** Browser lifecycle because the change is backend-only.

### Plan alignment

The PR has no active plan. Its acceptance criteria come from the issue.

### Verification

- **Checks:** git diff --check passed for abc123.
- **Gaps:** verification_gap — the integration database is unavailable.

### Verdict

PASS — The inspected write and read paths select the same tenant database.

### Summary and next step

- **Summary:** No findings. The database trace is based on source inspection.
- **Next step:** No action within this code review.
`;

const FINDING = `#### F1 [MINOR] Incorrect test oracle — tests/recipient-policy.test.mjs:36

- **Behavior:** The test reads its expected values from the enum it is checking.
- **Impact:** Removing a business-approved reason can leave the test green.
- **Evidence:** Followed the enum into the handler and the test input.
- **Fix direction:** Use the approved catalog as the test's expectation.
- **Confidence:** high`;

describe("review report finalization", () => {
    it.each([codeTarget, planTarget])("starts a draft with the same required sections used for $target finalization", options => {
        const previousIds = ["F4"];
        const draft = draftReviewReport({...options, previousIds});

        expect(draft).toContain(`- **Type:** ${options.target}`);
        expect(draft).toContain("### Finding resolutions\n\n- F4");
        expect(validateReviewReport(draft, {...options, previousIds})).toMatchObject({ok: false,
            errors: expect.arrayContaining(["Replace the remaining REVIEW_TODO placeholders."])});
    });

    it("rejects the verdict-first summary and missing sections seen in a shortened review", () => {
        const shortcut = `**PR — PASS WITH CAVEAT**

**F1 [MINOR] Incorrect test oracle.** The test repeats the implementation.

### Verification

The checks passed.`;
        expect(validateReviewReport(shortcut, codeTarget)).toMatchObject({ok: false,
            errors: expect.arrayContaining(["Start with finding headings or the exact line No findings.",
                "Target: missing or empty section.", "Coverage: missing review entries.",
                "Plan alignment: missing or empty section.", "Summary and next step: missing or empty section."])});
    });

    it("accepts a corrected code report and points to a missing finding field", () => {
        const report = CLEAN_REPORT.replace("No findings.", FINDING)
            .replace("PASS —", "PASS WITH CAVEAT —").replace("No findings. ", "One minor issue. ");
        expect(validateReviewReport(report, codeTarget)).toMatchObject({ok: true, verdict: "PASS WITH CAVEAT"});
        expect(validateReviewReport(report.replace("- **Confidence:** high", ""), codeTarget)).toMatchObject({ok: false,
            errors: expect.arrayContaining(["F1: missing Confidence."])});
        expect(validateReviewReport(report.replace("PASS WITH CAVEAT", "PASS"), codeTarget)).toMatchObject({ok: false,
            errors: expect.arrayContaining(["Verdict conflicts with the reported findings."])});
    });

    it("requires and checks the plan's actionable decision and verdict", () => {
        const report = CLEAN_REPORT.replace("No findings.", `${FINDING}\n- **Actionable:** true`)
            .replace("Type:** code", "Type:** plan").replace("PASS —", "PLAN CHANGES REQUESTED —")
            .replace("No findings. ", "One actionable issue. ");
        expect(validateReviewReport(report, planTarget)).toMatchObject({ok: true, findings: [{id: "F1", severity: "MINOR", actionable: true}]});
        expect(validateReviewReport(report.replace("PLAN CHANGES REQUESTED", "PLAN READY WITH CAVEAT"), planTarget)).toMatchObject({ok: false,
            errors: expect.arrayContaining(["Verdict conflicts with the reported findings."])});
        expect(validateReviewReport(report.replace("- **Actionable:** true", ""), planTarget)).toMatchObject({ok: false,
            errors: expect.arrayContaining(["F1: missing Actionable."])});
    });

    it("checks prior IDs against the review input, with evidence for each resolution", () => {
        const report = CLEAN_REPORT.replace("### Plan alignment", "### Finding resolutions\n\n- F2 — resolved — The new test fails without the fix.\n\n### Plan alignment");
        expect(validateReviewReport(report, {...codeTarget, previousIds: ["F2"]})).toMatchObject({ok: true});
        expect(validateReviewReport(report, {...codeTarget, previousIds: ["F2", "F3"]})).toMatchObject({ok: false,
            errors: expect.arrayContaining(["Finding resolutions: missing F3."])});
        expect(validateReviewReport(report, codeTarget)).toMatchObject({ok: false,
            errors: expect.arrayContaining(["Finding resolutions: duplicate or unexpected ID F2."])});
    });

    it("recognizes incomplete reviews and ignores headings inside evidence snippets", () => {
        const snippet = "```markdown\n### Verdict\nPASS — sample output\n```";
        const report = CLEAN_REPORT.replace("### Plan alignment", `${snippet}\n\n### Plan alignment`)
            .replace("PASS — The inspected write and read paths select the same tenant database.", "INCOMPLETE — The required baseline is unavailable.");
        expect(validateReviewReport(report, codeTarget)).toMatchObject({ok: true, verdict: "INCOMPLETE"});
        expect(validateReviewReport(report.replace("### Coverage", "~~~markdown\n### Coverage").replace("- **Omitted axes:** Browser lifecycle because the change is backend-only.", "~~~"),
            codeTarget)).toMatchObject({ok: false, errors: expect.arrayContaining(["Coverage: missing or empty section."])});
    });

    it("validates the exact deliverable and returns a failing command status on omissions", () => {
        const path = fileURLToPath(new URL("../../../.agents/skills/_shared/scripts/review-report.mjs", import.meta.url));
        const directory = mkdtempSync(join(tmpdir(), "review-report-"));
        const report = join(directory, "review.md");
        const run = () => spawnSync(process.execPath, [path, "validate", "--target", "code", report], {encoding: "utf8"});
        try {
            writeFileSync(report, CLEAN_REPORT);
            expect(run()).toMatchObject({status: 0, stdout: "REVIEW_REPORT_VALID\n"});
            writeFileSync(report, CLEAN_REPORT.replace("- **Gaps:**", "- Gap:"));
            expect(run()).toMatchObject({status: 1, stderr: expect.stringContaining("Verification: missing Gaps.")});
        } finally {
            rmSync(directory, {recursive: true});
        }
    });
});
