import fs from "node:fs";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const read = (relative) => fs.readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const contract = read("../../../.agents/skills/_shared/references/task-plan-contract.md");
const selection = contract.split("### Dobór profilu wykonania")[1].split("## Kolejność i pokrycie źródła")[0].replace(/\s+/g, " ");
const skill = read("../../../.agents/skills/task-plan/SKILL.md");
const review = read("../../../.agents/skills/code-review/references/plan-review.md");

describe("qualitative WP executor selection contract", () => {
    it("makes the agent choose the lowest sufficient hierarchy profile without benchmark thresholds", () => {
        expect(selection).toContain("./.agents/config/model-hierarchy.json");
        expect(selection).toContain("Rozpatruj profile od dołu hierarchii");
        expect(selection).toContain("bezpośrednio niższy kandydat");
        expect(selection).toContain("Nie przestawiaj jej na podstawie benchmarków");
        expect(selection).toContain("sygnałami, nie progami dopuszczenia");
        expect(selection).toContain("Przy istotnej niepewności");
        expect(selection).not.toMatch(/minimumPoints|--minimum-points|recommendFreshProfile|selectLocalProfile/);
    });

    it("uses task-relevant benchmark evidence with honest gaps rather than mandatory scoring", () => {
        for (const url of ["https://aicodingdaily.com/leaderboard", "https://artificialanalysis.ai/",
            "https://www.swebench.com/", "https://www.tbench.ai/"]) {
            expect(selection).toContain(url);
        }
        expect(selection).toContain("tej samej fazie planowania");
        expect(selection).toContain("nie wszystkie rankingi dla każdego WP");
        expect(selection).toContain("nie automatyczna dyskwalifikacja profilu");
        expect(selection).toContain("nie agreguj różnych skal");
    });

    it("keeps WP prose short and records exact profiles and shared evidence in the environment", () => {
        expect(selection).toContain("1–3 zdania");
        expect(selection).toContain("Zapisz raz w `Execution environment` pole `Profile evidence`");
        expect(selection).toContain("Nie powtarzaj modelu, reasoning, URL-i, dat");
        expect(selection).toContain("override z dokładnym modelem");
        expect(selection).toContain("pozostają czytelne bez migracji");
        expect(skill).toContain("helper dostarcza dane, nie rekomendację");
        expect(skill).not.toMatch(/--minimum-points|minimumPoints/);
        expect(review).toContain("lowest sufficient model/reasoning profile");
        expect(review).toContain("immediately lower candidate");
        expect(review).toContain("do not require migration");
        expect(review).not.toContain("names the threshold from that difficulty");
    });
});
