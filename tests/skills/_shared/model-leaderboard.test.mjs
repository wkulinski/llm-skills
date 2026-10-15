import {spawnSync} from "node:child_process";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {afterEach, describe, expect, it, vi} from "vitest";
import {compareFreshProfiles, fetchFreshLeaderboard, LEADERBOARD_URL, LeaderboardError, parseLeaderboardHtml}
    from "../../../.agents/skills/_shared/scripts/model-leaderboard.mjs";

// Displayed labels deliberately differ from local identifiers: pairing is explicit.
const entries = [["Model X (Low)", 40], ["Model Y (Max)", 25], ["Model G (Medium)", 35], ["Model Y (Medium)", 30]]
    .map(([label, totalPoints]) => ({label, totalPoints}));
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

function runCli(args) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "model-leaderboard-cli-"));
    try {
        const fetchMarker = path.join(root, "fetch-called");
        const preloadPath = path.join(root, "synthetic-fetch.mjs");
        fs.writeFileSync(preloadPath, `import fs from "node:fs";
globalThis.fetch = async () => {
    fs.writeFileSync(${JSON.stringify(fetchMarker)}, "called");
    return {ok: true, status: 200, headers: new Headers({"content-type": "text/html"}),
        text: async () => ${JSON.stringify(table())}};
};
`);
        const result = spawnSync(process.execPath, ["--import", preloadPath, CLI_SCRIPT, ...args], {
            encoding: "utf8",
            timeout: 10000,
        });
        return {...result, fetched: fs.existsSync(fetchMarker)};
    } finally {
        fs.rmSync(root, {recursive: true, force: true});
    }
}

afterEach(() => vi.restoreAllMocks());

describe("fresh model evidence and external profile comparison", () => {
    it.each(["recommend", "unknown"])("rejects unsupported CLI command %s before fetching", (command) => {
        const result = runCli([command]);
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(2);
        expect(result.stdout).toBe("");
        expect(JSON.parse(result.stderr)).toMatchObject({error: "INVALID_ARGUMENT"});
        expect(result.fetched).toBe(false);
    });

    it("prints benchmark rows as evidence without selecting or reordering a profile", () => {
        const result = runCli(["entries"]);
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(0);
        expect(result.stderr).toBe("");
        const evidence = JSON.parse(result.stdout);
        expect(evidence).toMatchObject({entries, source: LEADERBOARD_URL});
        expect(evidence).not.toHaveProperty("selected");
        expect(Number.isNaN(Date.parse(evidence.fetchedAt))).toBe(false);
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

    it("fetches fresh evidence on every call with no-store and no filesystem writes", async () => {
        const writeSync = vi.spyOn(fs, "writeFileSync");
        const write = vi.spyOn(fs, "writeFile");
        const writeAsync = vi.spyOn(fsPromises, "writeFile");
        const fetchImpl = vi.fn().mockResolvedValueOnce(response())
            .mockResolvedValueOnce(response(table(entries.map((entry) => ({...entry, totalPoints: 20})))));
        const first = await fetchFreshLeaderboard({fetchImpl});
        const second = await fetchFreshLeaderboard({fetchImpl});
        expect(first).toMatchObject({entries, source: LEADERBOARD_URL});
        expect(Number.isNaN(Date.parse(first.fetchedAt))).toBe(false);
        expect(second.entries).toEqual(entries.map((entry) => ({...entry, totalPoints: 20})));
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        for (const call of fetchImpl.mock.calls) {
            expect(call[0]).toBe(LEADERBOARD_URL);
            expect(call[1]).toMatchObject({cache: "no-store", signal: expect.any(AbortSignal)});
        }
        expect(first).not.toHaveProperty("selected");
        expect(first).not.toHaveProperty("html");
        expect(writeSync).not.toHaveBeenCalled();
        expect(write).not.toHaveBeenCalled();
        expect(writeAsync).not.toHaveBeenCalled();
    });

    it("reports controlled remote errors without leaking content", async () => {
        for (const fetchImpl of [async () => { throw new Error("private response"); },
            async () => ({...response(), ok: false, status: 503}),
            async () => ({...response(), headers: new Headers({"content-type": "application/json"})}),
            async () => response("private response")]) {
            const error = await fetchFreshLeaderboard({fetchImpl}).catch((error) => error);
            expect(error).toBeInstanceOf(LeaderboardError);
            expect(error.message).not.toContain("private response");
        }
        await expect(fetchFreshLeaderboard({fetchImpl: null})).rejects.toMatchObject({code: "INVALID_FETCH_IMPLEMENTATION"});
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
