import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {describe, expect, it} from "vitest";

import {
    isFillerItem,
    parseCommitMessageDraft,
    renderCommitMessage,
    renderCommitMessageDraftToFile,
    sectionKeyFromLabel,
} from "../../../.agents/skills/commit-message-write/scripts/commit-message-render.mjs";

describe("commit-message-render", () => {
    it("parses and renders a full draft", () => {
        const draft = parseCommitMessageDraft(`
            Subject: feat: add render pipeline
            general: General changes
            - update docs
            db: Database schema changes
            - add index
            cli: CLI command API changes
            - expose --output
        `);

        expect(renderCommitMessage(draft)).toBe(
            "feat: add render pipeline\n\n## General changes\n- update docs\n\n## Database schema changes\n- add index\n\n## CLI command API changes\n- expose --output\n\n",
        );
    });

    it("takes section headings from the draft instead of imposing a language", () => {
        const draft = parseCommitMessageDraft("Subject: fix: poprawiono walidację\ncli: Zmiany API poleceń CLI\n- nowa opcja --dry-run\n");
        expect(renderCommitMessage(draft)).toBe("fix: poprawiono walidację\n\n## Zmiany API poleceń CLI\n- nowa opcja --dry-run\n\n");
        expect(() => parseCommitMessageDraft("Subject: fix: x\ngeneral:\n- item\n")).toThrow("Missing heading for section general");
        expect(() => parseCommitMessageDraft("Subject: fix: x\ngeneral: A\n- a\ngeneral: B\n- b\n")).toThrow("Duplicate section: general");
    });

    it("rejects filler items and unknown sections", () => {
        expect(isFillerItem("Brak zmian")).toBe(true);
        expect(sectionKeyFromLabel("db")).toBe("db");
        expect(() => parseCommitMessageDraft(`
            Subject: feat: add render pipeline
            other: Other
            - nope
        `)).toThrow("Unknown section: other");
        expect(() => parseCommitMessageDraft(`
            Subject: feat: add render pipeline
            general: General changes
            - Brak zmian
        `)).toThrow("Filler bullet is not allowed: Brak zmian");
    });

    it("writes the rendered message to a file", async () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "commit-message-render-vitest-"));
        try {
            const outputFile = path.join(tempRoot, "commit-message.txt");
            await renderCommitMessageDraftToFile({
                input: [
                    "Subject: fix: stabilize output",
                    "general: General changes",
                    "- tighten validation",
                    "",
                ].join("\n"),
                outputFile,
            });

            expect(readFileSync(outputFile, "utf-8")).toBe("fix: stabilize output\n\n## General changes\n- tighten validation\n\n");
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });
});
