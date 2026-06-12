import {parseCodeceptionJunit} from "./codeception-junit.mjs";
import {parseEslintJson} from "./eslint-json.mjs";
import {parsePhpStanJson} from "./phpstan-json.mjs";

function buildFailureSummary(outputConfig, stdoutTail, stderrTail, errorMessage, stdoutParserInput, stderrParserInput) {
    const textParts = [stdoutTail, stderrTail, errorMessage].filter((part) => part && part.length > 0);
    const combinedTail = textParts.join("\n");
    const summary = parseFailureSummary(
        outputConfig.parser,
        stdoutParserInput,
        stderrParserInput,
        combinedTail
    );
    return limitSummaryLines(summary, outputConfig);
}

function parseFailureSummary(parser, stdout, stderr, combined) {
    if (parser === "phpstan-json") {
        const parsed = parsePhpStanJson(stdout) ?? parsePhpStanJson(stderr);
        if (parsed && parsed.length > 0) {
            return parsed;
        }
    }

    if (parser === "eslint-json") {
        const parsed = parseEslintJson(stdout) ?? parseEslintJson(stderr);
        if (parsed && parsed.length > 0) {
            return parsed;
        }
    }

    if (parser === "codeception-junit") {
        const parsed = parseCodeceptionJunit(stdout) ?? parseCodeceptionJunit(stderr);
        if (parsed && parsed.length > 0) {
            return parsed;
        }
    }

    return genericTail(combined);
}

function genericTail(text) {
    return text
        .split("\n")
        .map((line) => line.trimEnd())
        .filter((line) => line.trim().length > 0);
}

function limitSummaryLines(lines, outputConfig) {
    const normalized = lines.map((line) => outputConfig.stripAnsi ? stripAnsi(line) : line);
    const maxBytes = outputConfig.maxOutputBytes;
    const tailLines = normalized.slice(-outputConfig.failTailLines);
    const limited = [];
    let usedBytes = 0;

    for (const line of tailLines.reverse()) {
        const lineBytes = Buffer.byteLength(line, "utf-8");
        if (usedBytes + lineBytes > maxBytes && limited.length > 0) {
            break;
        }
        limited.push(truncateLineToBytes(line, maxBytes));
        usedBytes += Math.min(lineBytes, maxBytes);
    }

    return limited.reverse();
}

function truncateLineToBytes(line, maxBytes) {
    if (Buffer.byteLength(line, "utf-8") <= maxBytes) {
        return line;
    }

    const suffix = " ...[truncated]";
    const suffixBytes = Buffer.byteLength(suffix, "utf-8");
    const buffer = Buffer.from(line, "utf-8").subarray(0, Math.max(0, maxBytes - suffixBytes));
    return `${buffer.toString("utf-8")}${suffix}`;
}

function stripAnsi(text) {
    return text.replace(/\u001b\[[0-9;]*m/g, "");
}

export {
    buildFailureSummary,
    genericTail,
    limitSummaryLines,
    parseFailureSummary,
    stripAnsi,
    truncateLineToBytes,
};
