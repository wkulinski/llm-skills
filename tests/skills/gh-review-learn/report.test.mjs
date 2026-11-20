import {describe, expect, it} from "vitest";
import os from "node:os";
import {buildReportModel, renderReport, shellCommand, main} from "../../../.agents/skills/gh-review-learn/scripts/report.mjs";
import {RULES, fingerprint} from "../../../.agents/skills/gh-review-learn/scripts/contracts.mjs";

function fixture() {
    const digest = fingerprint("docs");
    const entries = [1, 2].map((number) => ({prId: `PR${number}`, rules: RULES, contextFingerprint: digest, analysis: "needs_decision", delivery: "delivery_pending", documentationChangeIds: ["C1", "C2"], documents: [{path: "README.md", beforeHash: digest, afterHash: digest}],
        assessments: [{id: `A${number}`, historical: "unresolved", currency: "no_evidence", rationale: "Needs runtime proof", sources: [{id: `S${number}`, start: 0, end: 4, url: `https://example.test/pr/${number}#comment`}]}]}));
    const change = {id: "C1", revision: 1, path: "README.md", section: "Verification Rules", description: "Read resulting bytes before confirming delivery", rationale: "Two reviews found the same missing check", status: "applied", references: entries.map((entry, i) => ({prId: entry.prId, assessmentId: `A${i + 1}`}))};
    const lock = {schemaVersion: 2, repository: {id: "R", name: "example/project", branch: "main"}, rules: RULES, entries, documentationChanges: [change, {...structuredClone(change), id: "C2", status: "proposed", description: "Record the scope separately"}], activeBatch: null, activeDelivery: null, lastDelivery: null};
    const event = {event: "confirmed", operationId: "op-1", newlyApplied: [{id: "C1", revision: 1}], changedFiles: ["README.md"], receipt: {contextFingerprint: digest}};
    return {lock, event, root: "/project", diff: "--- README.md\n+++ README.md\n+Read resulting bytes\n", diffArtifact: "/cache/op-1.diff"};
}
describe("operation reports", () => {
    it("starts with the actual rule, document, rationale and all source links exactly once", () => {
        const model = buildReportModel(fixture()); const text = renderReport(model);
        expect(text.startsWith("Wprowadzono zmiany do dokumentacji.")).toBe(true);
        expect(model.applied).toHaveLength(1); expect(model.proposals.map((change) => change.id)).toEqual(["C2"]);
        expect(model.applied[0].documentLink).toBe("/project/README.md#verification-rules");
        expect(model.applied[0].sourceLinks.map((link) => link.url)).toEqual(["https://example.test/pr/1#comment", "https://example.test/pr/2#comment"]);
        expect(text).toContain("Two reviews found the same missing check"); expect(text).toContain("+Read resulting bytes");
        const sections = ["## Wprowadzone zmiany", "## Propozycje niezastosowane", "## Ustalenia bez zmiany dokumentacji", "## Postęp i kontynuacja"].map((title) => text.indexOf(title));
        expect(sections.every((index, i) => i === 0 || index > sections[i - 1])).toBe(true);
    });
    it.each(["analysis_recorded", "previously_confirmed", "dry_run"])("never presents old applied records as new edits for %s", (event) => {
        const input = fixture(); input.event = {event, operationId: "op-1"};
        const model = buildReportModel(input);
        expect(renderReport(model).startsWith("Nie wprowadzono zmian do dokumentacji.")).toBe(true);
        expect(model.applied).toEqual([]); expect(model.previousApplications).toEqual([{id: "C1", revision: 1}]);
        if (event === "previously_confirmed") { expect(model.reason).toContain("potwierdzona wcześniej"); }
    });
    it("names edited files and unconfirmed progress after a write error without asserting application", () => {
        const input = fixture(); input.event = {event: "progress_unconfirmed", operationId: "op-1", changedFiles: ["README.md"]};
        const model = buildReportModel(input); const text = renderReport(model);
        expect(text.startsWith("Dokumentacja została zmieniona, ale zapis postępu nie został potwierdzony.")).toBe(true);
        expect(text).toContain("Pliki z edycjami: README.md"); expect(model.applied).toEqual([]); expect(model.diff.inline).toBeNull();
    });
    it("shows all 80 diff lines, links the full larger artifact and names cache loss", () => {
        const input = fixture(); input.diff = Array.from({length: 80}, (_, i) => `+Rule ${i}`).join("\n") + "\n";
        expect(buildReportModel(input).diff.inline).toBe(input.diff);
        input.diff += "+One more\n";
        const long = buildReportModel(input); expect(long.diff.inline).toBeNull(); expect(renderReport(long)).toContain("[Pełny diff](/cache/op-1.diff)");
        input.diff = null; input.diffArtifact = null;
        expect(buildReportModel(input).diff.gap).toContain("Brak dokładnego diffu");
    });
    it("resumes the stored batch ID, keeps batch size and reports known inventory limits", () => {
        const input = fixture(); input.event = {};
        input.lock.activeBatch = {id: "batch-1", limit: 20, prNumbers: [3, 4]};
        let model = buildReportModel(input);
        expect(model.progress.nextCommand).toContain("'resume' '--batch' 'batch-1'"); expect(model.progress.newRemaining).toBeNull();
        input.lock.lastBatch = input.lock.activeBatch; input.lock.activeBatch = null;
        input.inventory = {kind: "inventory", read: {completeness: "complete", finishedAt: "2026-11-20T00:00:00Z"}, prs: [{id: "PR1"}, {id: "PR2"}, {id: "PR3"}]};
        model = buildReportModel(input); expect(model.progress.newRemaining).toBe(1); expect(model.progress.nextCommand).toContain("'--batch-size' '20'");
        input.inventory.prs.pop(); model = buildReportModel(input);
        expect(model.progress.newRemaining).toBe(0); expect(model.progress.nextCommand).toBeNull(); expect(model.progress.continuation).toContain("nierozstrzygnięcia");
        expect(model.progress.unresolved).toBe(2); expect(model.progress.pendingDelivery).toBe(2);
        expect(renderReport(model)).toContain("Kolejki mogą się nakładać");
    });
    it("keeps V1 metadata gaps explicit without inventing change descriptions", () => {
        const input = fixture(); input.lock.schemaVersion = 1; input.lock.documentationChanges = []; input.event = {};
        const model = buildReportModel(input);
        expect(model.historicalGaps).toHaveLength(2); expect(model.applied).toEqual([]); expect(renderReport(model)).toContain("brak szczegółowego opisu zmian V1");
    });
    it("explains no-change dispositions instead of dropping their recorded rationale", () => {
        const input = fixture(); input.event = {event: "analysis_recorded"};
        input.lock.entries[0].dispositions = [{sourceId: "S1", status: "no_learning", rationale: "The existing entrypoint already links the complete rule"}];
        expect(renderReport(buildReportModel(input))).toContain("The existing entrypoint already links the complete rule");
    });
    it("can render a saved event without requiring its optional source cache", () => {
        const input = fixture(); input.event.refreshedPrIds = ["PR1", "PR2"];
        expect(buildReportModel(input).progress.refreshedPrIds).toEqual(["PR1", "PR2"]);
    });
    it("quotes copied commands and supports help without repository or network", () => {
        expect(shellCommand(["node", "$(not-run)", "branch'quoted"])).toBe("'node' '$(not-run)' 'branch'\\''quoted'");
        expect(main(["--help"], {cwd: os.tmpdir()}).stdout).toContain("Usage:");
    });
});
