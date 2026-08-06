import {describe, expect, it} from "vitest";

import {
    extractReadEventFromCommand,
    normalizeReadObservation,
    parseReadEventArgs,
} from "../../../.agents/skills/_shared/scripts/read-purpose.mjs";

describe("read-purpose contract", () => {
    it("normalizes a full path read event", () => {
        expect(normalizeReadObservation({
            purpose: "read-before-write",
            source: "parent",
            read_mode: "full",
            resource_kind: "path",
            path: "./src\\Example.mjs",
        })).toEqual({
            valid: true,
            errors: [],
            observation: {
                event: "read",
                purpose: "read-before-write",
                source: "parent",
                read_mode: "full",
                resource_kind: "path",
                resource: "src/Example.mjs",
            },
        });
    });

    it("keeps legacy text arguments unstructured", () => {
        expect(parseReadEventArgs(["git", "diff", "--stat"])).toEqual({
            structured: false,
            message: ["git", "diff", "--stat"],
            errors: [],
        });
        expect(parseReadEventArgs(["rg", "--path", "foo.txt"])).toEqual({
            structured: false,
            message: ["rg", "--path", "foo.txt"],
            errors: [],
        });
    });

    it("extracts structured state-readlog metadata from a shell command", () => {
        expect(extractReadEventFromCommand(
            "node .agents/skills/code-implement/scripts/state-readlog.mjs --purpose verification --source scout --path tests/example.mjs",
        )).toMatchObject({
            event: "read",
            purpose: "verification",
            source: "scout",
            read_mode: "full",
            resource_kind: "path",
            resource: "tests/example.mjs",
        });
    });

    it("does not treat a quoted or non-executable mention as a state-readlog invocation", () => {
        expect(extractReadEventFromCommand("echo 'run state-readlog.mjs --purpose verification --path foo.txt'")).toBeNull();
        expect(extractReadEventFromCommand("echo state-readlog.mjs --purpose verification --path foo.txt")).toBeNull();
    });

    it("rejects path traversal and unqualified read events", () => {
        expect(normalizeReadObservation({purpose: "discovery", path: "../secrets.txt"}).valid).toBe(false);
        expect(normalizeReadObservation({purpose: "discovery"}).errors).toContain("path or scope is required for read events");
    });
});
