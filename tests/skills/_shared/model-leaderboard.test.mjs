import {spawnSync} from "node:child_process";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {afterEach, describe, expect, it, vi} from "vitest";
import {compareFreshProfiles, fetchFreshLeaderboard, LEADERBOARD_URL, parseLeaderboardHtml, recommendFreshProfile, selectLocalProfile}
    from "../../../.agents/skills/_shared/scripts/model-leaderboard.mjs";

const profiles = [{model: "X", reasoning: "low"}, {model: "Y", reasoning: "max"},
    {model: "G", reasoning: "medium"}, {model: "Y", reasoning: "medium"}];
const hierarchy = {version: 1, order: "strongest-to-weakest", profiles};
// Displayed labels deliberately differ from local identifiers: pairing is explicit.
const entries = [["Model X (Low)", 40], ["Model Y (Max)", 25], ["Model G (Medium)", 35], ["Model Y (Medium)", 30]]
    .map(([label, totalPoints]) => ({label, totalPoints}));
const pairings = profiles.map((profile, index) => ({...profile, label: entries[index].label}));
const CLI_SCRIPT = fileURLToPath(new URL("../../../.agents/skills/_shared/scripts/model-leaderboard.mjs", import.meta.url));

function table(rows = entries) {
    return `<table><thead><tr><th>#</th><th>Model</th><th>Total points (max 70)</th></tr>
<tr><th>Other project scores</th></tr></thead><tbody>${rows.map((row, i) =>
    `<tr><td>${i + 1}</td><td><a href="https://aicodingdaily.com/model/synthetic-${i}">${row.label}</a></td><td>${row.totalPoints}</td>${"<td>other</td>".repeat(8)}</tr>`).join("")}</tbody></table>`;
}

function response(html = table()) {
    return {ok: true, status: 200, headers: new Headers({"content-type": "text/html; charset=utf-8"}),
        text: async () => html};
}

function runRecommendationCli(minimumPoints) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "model-leaderboard-cli-"));
    try {
        const configDir = path.join(root, ".agents", "config");
        fs.mkdirSync(configDir, {recursive: true});
        fs.writeFileSync(path.join(configDir, "model-hierarchy.json"), JSON.stringify(hierarchy));
        const pairingsPath = path.join(root, "pairings.json");
        fs.writeFileSync(pairingsPath, JSON.stringify(pairings));
        const fetchMarker = path.join(root, "fetch-called");
        const preloadPath = path.join(root, "synthetic-fetch.mjs");
        fs.writeFileSync(preloadPath, `import fs from "node:fs";
globalThis.fetch = async () => {
    fs.writeFileSync(${JSON.stringify(fetchMarker)}, "called");
    return {ok: true, status: 200, headers: new Headers({"content-type": "text/html"}),
        text: async () => ${JSON.stringify(table())}};
};
`);
        const result = spawnSync(process.execPath, ["--import", preloadPath, CLI_SCRIPT, "recommend",
            "--root", root, "--pairings", pairingsPath, "--minimum-points", minimumPoints], {
            encoding: "utf8",
            timeout: 10000,
        });
        return {...result, fetched: fs.existsSync(fetchMarker)};
    } finally {
        fs.rmSync(root, {recursive: true, force: true});
    }
}

afterEach(() => vi.restoreAllMocks());

describe("fresh local profile recommendation", () => {
    it.each(["", " \t\n"])("rejects blank CLI thresholds before fetching: %j", (minimumPoints) => {
        const result = runRecommendationCli(minimumPoints);
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(2);
        expect(result.stdout).toBe("");
        expect(JSON.parse(result.stderr)).toMatchObject({error: "INVALID_ARGUMENT"});
        expect(result.fetched).toBe(false);
    });

    it.each([
        {argument: "0", minimumPoints: 0, model: "Y", reasoning: "medium"},
        {argument: "34.5", minimumPoints: 34.5, model: "G", reasoning: "medium"},
    ])("accepts the numeric CLI threshold $argument without changing its value", ({argument, minimumPoints, model, reasoning}) => {
        const result = runRecommendationCli(argument);
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(0);
        expect(result.stderr).toBe("");
        expect(JSON.parse(result.stdout)).toMatchObject({status: "recommended", minimumPoints,
            selected: {model, reasoning}});
        expect(result.fetched).toBe(true);
    });

    it("compares labelled external profiles freshly with tolerance and controlled gaps", async () => {
        const required = {model: "G", reasoning: "medium", label: "Model G (Medium)"};
        const current = {model: "Z", reasoning: "max", label: "Model Z (Max)"};
        const rows = (totalPoints) => [{label: required.label, totalPoints: 35}, {label: current.label, totalPoints}];
        const fetchImpl = vi.fn().mockResolvedValueOnce(response(table(rows(33))))
            .mockResolvedValueOnce(response(table(rows(32.99))));
        expect(await compareFreshProfiles(required, current, {fetchImpl}))
            .toMatchObject({status: "compared", sufficient: true, tolerance: 2, current: {totalPoints: 33}});
        expect(await compareFreshProfiles(required, current, {fetchImpl})).toMatchObject({status: "compared", sufficient: false});
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        for (const rowsWithGap of [[rows(33)[0]], [rows(33)[1]], [rows(33)[0], {label: "Model Z (High)", totalPoints: 40}]]) {
            expect(await compareFreshProfiles(required, current, {fetchImpl: async () => response(table(rowsWithGap))}))
                .toMatchObject({status: "decision-required", sufficient: false, reason: "label-not-found"});
        }
        const unread = vi.fn();
        expect(await compareFreshProfiles(required, {...current, label: required.label}, {fetchImpl: unread}))
            .toMatchObject({status: "decision-required", reason: "ambiguous-pairing"});
        expect(unread).not.toHaveBeenCalled();
        expect(await compareFreshProfiles(required, current, {fetchImpl: async () => { throw new Error("private"); }}))
            .toMatchObject({status: "decision-required", code: "LEADERBOARD_FETCH_FAILED"});
        await expect(compareFreshProfiles(required, {model: "Z", reasoning: "max"}, {fetchImpl: unread})).rejects.toThrow();
    });

    it("chooses local rank rather than sorting nonmonotonic points, without tolerance", () => {
        expect(selectLocalProfile(hierarchy, {entries, minimumPoints: 34, pairings}).selected)
            .toEqual({model: "G", reasoning: "medium", rank: 2, label: "Model G (Medium)", totalPoints: 35});
        expect(selectLocalProfile(hierarchy, {entries, minimumPoints: 35, pairings}).selected.model).toBe("G");
        expect(selectLocalProfile(hierarchy, {entries, minimumPoints: 36, pairings}).selected.model).toBe("X");
        expect(hierarchy.profiles).toEqual(profiles);
    });

    it("keeps unpaired profiles unscored without blocking a confirmed candidate", () => {
        const result = selectLocalProfile(hierarchy, {entries, minimumPoints: 34, pairings: pairings.slice(2)});
        expect(result.selected.model).toBe("G");
        expect(result.unscored).toEqual(profiles.slice(0, 2).map((profile, rank) => ({...profile, rank})));
        expect(selectLocalProfile(hierarchy, {entries, minimumPoints: 41, pairings}))
            .toMatchObject({status: "decision-required", reason: "no-candidate", selected: null});
        expect(selectLocalProfile(hierarchy, {entries, minimumPoints: 0}).selected).toBeNull();
    });

    it("never derives points from names: unknown or shared labels require a decision", () => {
        expect(selectLocalProfile(hierarchy, {entries, minimumPoints: 34, pairings: [{...pairings[2], label: "Model G (medium)"}]}))
            .toMatchObject({status: "decision-required", reason: "label-not-found", labels: ["Model G (medium)"]});
        expect(selectLocalProfile(hierarchy, {entries, minimumPoints: 34, pairings: [pairings[2], {...pairings[3], label: pairings[2].label}]}))
            .toMatchObject({status: "decision-required", reason: "ambiguous-pairing", selected: null});
    });

    it("rejects malformed inputs and pairings outside the local hierarchy before comparing", () => {
        for (const minimumPoints of [-1, 71, Infinity, NaN, "34", undefined]) {
            expect(() => selectLocalProfile(hierarchy, {entries, minimumPoints, pairings})).toThrow();
        }
        for (const totalPoints of [-1, 71, Infinity, NaN, "40"]) {
            expect(() => selectLocalProfile(hierarchy, {entries: [{...entries[0], totalPoints}], minimumPoints: 34})).toThrow();
        }
        expect(() => selectLocalProfile(hierarchy, {entries: [entries[0], entries[0]], minimumPoints: 34})).toThrow();
        expect(() => selectLocalProfile({...hierarchy, profiles: [profiles[0], profiles[0]]}, {entries, minimumPoints: 34})).toThrow();
        expect(() => selectLocalProfile({...hierarchy, order: "weakest-to-strongest"}, {entries, minimumPoints: 34})).toThrow();
        for (const invalid of [{}, [{model: "Q", reasoning: "low", label: "Model X (Low)"}], [{...pairings[0], label: ""}],
            [pairings[0], pairings[0]]]) {
            expect(() => selectLocalProfile(hierarchy, {entries, minimumPoints: 34, pairings: invalid})).toThrow();
        }
    });

    it("parses only the declared table, preserving displayed labels", () => {
        expect(parseLeaderboardHtml(table())).toEqual(entries);
        expect(parseLeaderboardHtml(table([{label: "Z&amp;Q  (High)", totalPoints: 34.5}])))
            .toEqual([{label: "Z&Q (High)", totalPoints: 34.5}]);
        expect(parseLeaderboardHtml(table([{label: "&#88;", totalPoints: 0}])))
            .toEqual([{label: "X", totalPoints: 0}]);
        expect(parseLeaderboardHtml(`<!-- <table>fake</table> --><script>const x='<table>fake</table>';</script>${table()}`)).toEqual(entries);
    });

    it("fails closed on layout, scale, row, number and duplicate changes", () => {
        const original = table();
        const malformed = ["", "<html>unavailable</html>", table([]), original + original,
            original.replace("max 70", "max 100"), original.replace("Model</th>", "Models</th>"),
            original.replace("<td>40</td>", "<td>71</td>"), original.replace("<td>40</td>", "<td>40?</td>"),
            original.replace("<td>40</td>", "<td><span>40</span></td>"),
            original.replace("<td>other</td>", ""), original.replace("</td>", ""),
            original.replace("</tr>", ""), original.replace("</tbody>", ""),
            original.replace("</tbody>", "</tbody><tr><td>unexpected</td></tr>"),
            original.replace("https://aicodingdaily.com/model/", "https://other.invalid/model/"),
            original.replace("Model X (Low)", "Model X&unknown; (Low)"), table([entries[0], entries[0]])];
        for (const html of malformed) expect(() => parseLeaderboardHtml(html)).toThrow();
    });

    it("fetches anew for every decision with no-store and no filesystem writes", async () => {
        const writeSync = vi.spyOn(fs, "writeFileSync");
        const write = vi.spyOn(fs, "writeFile");
        const writeAsync = vi.spyOn(fsPromises, "writeFile");
        const fetchImpl = vi.fn().mockResolvedValueOnce(response())
            .mockResolvedValueOnce(response(table(entries.map((entry) => ({...entry, totalPoints: 20})))));
        const first = await recommendFreshProfile(hierarchy, {minimumPoints: 34, pairings, fetchImpl});
        const second = await recommendFreshProfile(hierarchy, {minimumPoints: 34, pairings, fetchImpl});
        expect(first).toMatchObject({status: "recommended", selected: {model: "G", totalPoints: 35}, source: LEADERBOARD_URL});
        expect(Number.isNaN(Date.parse(first.fetchedAt))).toBe(false);
        expect(second).toMatchObject({status: "decision-required", reason: "no-candidate"});
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        for (const call of fetchImpl.mock.calls) {
            expect(call[0]).toBe(LEADERBOARD_URL);
            expect(call[1]).toMatchObject({cache: "no-store", signal: expect.any(AbortSignal)});
        }
        expect(first).not.toHaveProperty("entries");
        expect(first).not.toHaveProperty("html");
        expect(writeSync).not.toHaveBeenCalled();
        expect(write).not.toHaveBeenCalled();
        expect(writeAsync).not.toHaveBeenCalled();
    });

    it("requires a decision on remote errors without leaking content", async () => {
        for (const fetchImpl of [async () => { throw new Error("private response"); },
            async () => ({...response(), ok: false, status: 503}),
            async () => ({...response(), headers: new Headers({"content-type": "application/json"})}),
            async () => response("private response")]) {
            const result = await recommendFreshProfile(hierarchy, {minimumPoints: 34, pairings, fetchImpl});
            expect(result).toMatchObject({status: "decision-required", reason: "ranking-unavailable", selected: null});
            expect(JSON.stringify(result)).not.toContain("private response");
        }
        const fetchImpl = vi.fn();
        await expect(recommendFreshProfile(hierarchy, {minimumPoints: NaN, pairings, fetchImpl})).rejects.toThrow();
        await expect(recommendFreshProfile(hierarchy, {minimumPoints: 34, pairings: [{...pairings[0], model: "Q"}], fetchImpl})).rejects.toThrow();
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("shares the fresh fetch boundary without persisting or leaking the raw response", async () => {
        const fetchImpl = vi.fn().mockResolvedValue(response());
        expect(await fetchFreshLeaderboard({fetchImpl})).toMatchObject({entries, source: LEADERBOARD_URL});
        expect(await fetchFreshLeaderboard({fetchImpl})).not.toHaveProperty("html");
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        await expect(fetchFreshLeaderboard({fetchImpl: async () => { throw new Error("private body"); }}))
            .rejects.toMatchObject({code: "LEADERBOARD_FETCH_FAILED"});
    });
});
