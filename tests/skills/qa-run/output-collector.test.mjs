import {describe, expect, it} from "vitest";

import {createOutputCollector} from "../../../.agents/skills/qa-run/scripts/run-matrix/execution/output-collector.mjs";

describe("run-matrix output collector", () => {
    it("keeps parser input from the beginning and tail output from the end", () => {
        const collector = createOutputCollector(4, 3);

        collector.append("ab");
        collector.append("cdef");

        expect(collector.parserContent()).toBe("abc");
        expect(collector.tailContent()).toBe("cdef");
    });

    it("trims oversized tail chunks without affecting parser input", () => {
        const collector = createOutputCollector(5, 10);

        collector.append(Buffer.from("1234"));
        collector.append(Buffer.from("5678"));

        expect(collector.parserContent()).toBe("12345678");
        expect(collector.tailContent()).toBe("45678");
    });
});
