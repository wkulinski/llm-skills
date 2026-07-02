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
} from "../../../.agents/skills/_shared/scripts/commit-message-render.mjs";

describe("commit-message-render", () => {
    it("parses and renders a full draft", () => {
        const draft = parseCommitMessageDraft(`
            Subject: feat: add render pipeline
            general:
            - update docs
            db:
            - add index
            cli:
            - expose --output
        `);

        expect(renderCommitMessage(draft)).toBe(
            "feat: add render pipeline\n\n## Zmiany ogólne\n- update docs\n\n## Zmiany wpływające na strukturę bazy danych\n- add index\n\n## Zmiany API poleceń CLI\n- expose --output\n\n",
        );
    });

    it("rejects filler items and unknown sections", () => {
        expect(isFillerItem("Brak zmian")).toBe(true);
        expect(sectionKeyFromLabel("db")).toBe("db");
        expect(() => parseCommitMessageDraft(`
            Subject: feat: add render pipeline
            other:
            - nope
        `)).toThrow("Unknown section: other");
        expect(() => parseCommitMessageDraft(`
            Subject: feat: add render pipeline
            general:
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
                    "general:",
                    "- tighten validation",
                    "",
                ].join("\n"),
                outputFile,
            });

            expect(readFileSync(outputFile, "utf-8")).toBe("fix: stabilize output\n\n## Zmiany ogólne\n- tighten validation\n\n");
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });
});
