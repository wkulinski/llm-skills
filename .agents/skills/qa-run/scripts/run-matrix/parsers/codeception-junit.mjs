import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

function parseCodeceptionJunit(text) {
    const xmlInputs = collectJunitXmlInputs(text);
    if (xmlInputs.length === 0) {
        return null;
    }

    const lines = [];
    for (const xmlInput of xmlInputs) {
        for (const testcase of parseJunitTestCases(xmlInput)) {
            for (const failure of testcase.failures) {
                lines.push(formatFailureLine(testcase.attrs, failure));
            }
        }
    }

    return lines;
}

function collectJunitXmlInputs(text) {
    if (typeof text !== "string" || text.length === 0) {
        return [];
    }

    const inputs = [];
    if (looksLikeJunitXml(text)) {
        inputs.push(text);
    }

    for (const reportPath of extractReportPaths(text)) {
        const reportContent = readTextFileOrNull(reportPath);
        if (looksLikeJunitXml(reportContent)) {
            inputs.push(reportContent);
        }
    }

    return inputs;
}

function looksLikeJunitXml(text) {
    return typeof text === "string"
        && text.includes("<test")
        && (text.includes("<testsuite") || text.includes("<testsuites"));
}

function extractReportPaths(text) {
    const paths = [];
    const fileUrlPattern = /file:\/\/[^\s<>"']+\.xml/g;

    for (const match of text.matchAll(fileUrlPattern)) {
        const reportPath = fileUrlToPathOrNull(match[0]);
        if (reportPath) {
            paths.push(reportPath);
        }
    }

    return paths;
}

function fileUrlToPathOrNull(url) {
    try {
        return fileURLToPath(url);
    } catch {
        return url.replace(/^file:\/\//, "");
    }
}

function readTextFileOrNull(path) {
    for (const candidate of candidateReportPaths(path)) {
        try {
            return readFileSync(candidate, "utf-8");
        } catch {
            // Try the next common host/container path mapping.
        }
    }

    return null;
}

function candidateReportPaths(path) {
    const paths = [path];
    const containerPrefixes = ["/srv/app/", "/app/", "/workspace/"];

    for (const prefix of containerPrefixes) {
        if (path.startsWith(prefix)) {
            paths.push(`${process.cwd()}/${path.slice(prefix.length)}`);
        }
    }

    return [...new Set(paths)];
}

function parseJunitTestCases(text) {
    const testcases = [];
    // This intentionally parses only the JUnit subset emitted by Codeception.
    // The skill must stay dependency-free across repositories.
    const openTagPattern = /<testcase\b([^>]*?)(\/?)>/gs;

    for (const match of text.matchAll(openTagPattern)) {
        const openStart = match.index ?? -1;
        const openEnd = openStart + match[0].length;
        const selfClosing = (match[2] ?? "") === "/" || match[0].trimEnd().endsWith("/>");
        if (openStart < 0 || selfClosing) {
            continue;
        }

        const closeStart = text.indexOf("</testcase>", openEnd);
        if (closeStart < 0) {
            continue;
        }

        const testcase = {
            attrs: parseXmlAttributes(match[1] ?? ""),
            failures: extractFailures(text.slice(openEnd, closeStart)),
        };
        if (testcase.failures.length > 0) {
            testcases.push(testcase);
        }
    }

    return testcases;
}

function extractFailures(testcaseBody) {
    const failures = [];
    const failurePattern = /<(failure|error)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g;

    for (const match of testcaseBody.matchAll(failurePattern)) {
        failures.push({
            attrs: parseXmlAttributes(match[2] ?? ""),
            body: match[3] ?? "",
            kind: match[1] ?? "failure",
        });
    }

    return failures;
}

function parseXmlAttributes(text) {
    const attrs = {};
    const attrPattern = /([\w:-]+)\s*=\s*(["'])(.*?)\2/gs;

    for (const match of text.matchAll(attrPattern)) {
        attrs[match[1]] = decodeXmlEntities(match[3] ?? "");
    }

    return attrs;
}

function formatFailureLine(testcaseAttrs, failure) {
    const location = formatTestLocation(testcaseAttrs, failure);
    const kind = failure.kind === "error" ? "ERROR" : "FAIL";
    const type = typeof failure.attrs.type === "string" && failure.attrs.type.length > 0
        ? ` [${failure.attrs.type}]`
        : "";
    const message = formatFailureMessage(testcaseAttrs, failure);

    return `${location} ${kind}${type}: ${message}`;
}

function formatFailureMessage(testcaseAttrs, failure) {
    const attrMessage = firstNonEmptyLine(failure.attrs.message);
    if (attrMessage && !isScenarioTitle(testcaseAttrs, attrMessage)) {
        return attrMessage;
    }

    const bodyLines = nonEmptyLines(failure.body);
    for (const line of bodyLines) {
        if (!isScenarioTitle(testcaseAttrs, line) && !isStackFrameLine(line)) {
            return line;
        }
    }

    return attrMessage ?? bodyLines[0] ?? "No failure message.";
}

function formatTestLocation(attrs, failure) {
    const {file, line} = extractFailureLocation(attrs, failure);
    const lineSuffix = line.length > 0 ? `:${line}` : "";
    const classname = firstNonEmptyString(attrs.classname, attrs.class);
    const name = typeof attrs.name === "string" && attrs.name.length > 0 ? attrs.name : "";
    if (classname.length > 0 && name.length > 0) {
        const fileSuffix = file.length > 0 ? ` (${file}${lineSuffix})` : "";
        return `${classname}::${name}${fileSuffix}`;
    }
    if (name.length > 0) {
        return name;
    }
    if (file.length > 0) {
        return `${file}${lineSuffix}`;
    }

    return "unknown-testcase";
}

function extractFailureLocation(attrs, failure) {
    const attrFile = typeof attrs.file === "string" && attrs.file.length > 0 ? attrs.file : "";
    const attrLine = typeof attrs.line === "string" && attrs.line.length > 0 ? attrs.line : "";
    if (attrFile.length > 0 && attrLine.length > 0) {
        return {file: attrFile, line: attrLine};
    }

    const frames = extractStackFrames(failure.body);
    const exactFrame = frames.find((frame) => attrFile.length > 0 && frame.file === attrFile);
    if (exactFrame) {
        return exactFrame;
    }

    const sourceFrame = frames.find((frame) => !frame.file.includes("/vendor/") && !frame.file.includes("/_generated/"));
    if (sourceFrame) {
        return sourceFrame;
    }

    if (frames.length > 0) {
        return frames[0];
    }

    return {file: attrFile, line: attrLine};
}

function extractStackFrames(text) {
    const frames = [];
    const framePattern = /([^\s"'<>]+\.php):(\d+)\b/g;
    for (const line of nonEmptyLines(text)) {
        for (const match of line.matchAll(framePattern)) {
            frames.push({
                file: match[1] ?? "",
                line: match[2] ?? "",
            });
        }
    }

    return frames;
}

function firstNonEmptyString(...values) {
    for (const value of values) {
        if (typeof value === "string" && value.length > 0) {
            return value;
        }
    }

    return "";
}

function firstNonEmptyLine(text) {
    return nonEmptyLines(text)[0] ?? null;
}

function nonEmptyLines(text) {
    if (typeof text !== "string" || text.length === 0) {
        return [];
    }
    const normalizedText = stripCdata(decodeXmlEntities(text));
    const lines = [];
    for (const line of normalizedText.split(/\r?\n/)) {
        const normalizedLine = line.replace(/\s+/g, " ").trim();
        if (normalizedLine.length > 0) {
            lines.push(normalizedLine);
        }
    }

    return lines;
}

function isScenarioTitle(attrs, line) {
    const classname = firstNonEmptyString(attrs.classname, attrs.class);
    const classBasename = classname.split("\\").pop() ?? "";
    const feature = typeof attrs.feature === "string" ? attrs.feature : "";
    if (classBasename.length === 0 || feature.length === 0) {
        return false;
    }

    const prefix = `${classBasename}:`;
    if (!line.startsWith(prefix)) {
        return false;
    }

    return normalizeDiagnosticText(line.slice(prefix.length)) === normalizeDiagnosticText(feature);
}

function isStackFrameLine(line) {
    return /^[^\s"'<>]+\.php:\d+\b/.test(line);
}

function normalizeDiagnosticText(text) {
    return text
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim()
        .toLowerCase();
}

function stripCdata(text) {
    return text
        .replace(/^\s*<!\[CDATA\[/, "")
        .replace(/\]\]>\s*$/, "");
}

function decodeXmlEntities(text) {
    return text
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
        .replace(/&#([0-9]+);/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
        .replace(/&quot;/g, "\"")
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
}

export {
    candidateReportPaths,
    collectJunitXmlInputs,
    decodeXmlEntities,
    parseCodeceptionJunit,
};
