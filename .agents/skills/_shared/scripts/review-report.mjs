#!/usr/bin/env node

import {readFileSync} from "node:fs";
import {parseArgs} from "node:util";
import {isMainModule} from "./is-main-module.mjs";

const SECTIONS = ["Target", "Coverage", "Finding resolutions", "Plan alignment", "Verification", "Verdict", "Summary and next step"];
const VERDICTS = {
    code: ["BLOCK", "CHANGES REQUESTED", "DISCUSS", "PASS WITH CAVEAT", "PASS"],
    plan: ["PLAN BLOCKED", "PLAN CHANGES REQUESTED", "PLAN DISCUSS", "PLAN READY WITH CAVEAT", "PLAN READY"],
};
const ID = /^F[1-9]\d*$/;
const FINDING = /^#### (F[1-9]\d*) \[(BLOCKER|MAJOR|MINOR|QUESTION|SUGGESTION)\] (\S.*?) — (\S.*:[1-9]\d*)$/;
const FIELD = /^- \*\*([A-Za-z ]+):\*\*[ \t]+(\S.*)$/;
const RESOLUTION = /^- (F[1-9]\d*) — (resolved|current|accepted) — (\S.*)$/;
const TODO = "<!-- REVIEW_TODO:";

function expectedSections(previousIds) {
    return previousIds.length ? SECTIONS : SECTIONS.filter(name => name !== "Finding resolutions");
}

function checkOptions(target, previousIds) {
    if (!Object.hasOwn(VERDICTS, target)) {
        throw new Error("--target must be code or plan");
    }
    if (previousIds.some(id => !ID.test(id)) || new Set(previousIds).size !== previousIds.length) {
        throw new Error("--previous must contain distinct finding IDs, for example F1,F2");
    }
}

export function draftReviewReport({target, previousIds = []}) {
    checkOptions(target, previousIds);
    const placeholder = text => `${TODO} ${text} -->`;
    const sections = {
        Target: [
            `- **Type:** ${target}`,
            `- **Artifact and revision:** ${placeholder("Record the reviewed path or change and exact version.")}`,
            `- **Scope:** ${placeholder("Record the accepted scope and any snapshot limits.")}`,
            `- **Requirements:** ${placeholder("Record outcomes and constraints from authoritative sources.")}`,
        ],
        Coverage: [placeholder("Record reviewed subjects, outcomes, evidence, gaps and applicable rule results."),
            `- **Omitted axes:** ${placeholder("Record omitted axes and reasons, or state none.")}`],
        "Finding resolutions": previousIds.map(id => `- ${id} — ${placeholder("Supply status and evidence.")}`),
        "Plan alignment": [placeholder("Record the relevant plan and mapped scope, or the reason it is unavailable or inapplicable.")],
        Verification: [
            `- **Checks:** ${placeholder("Record commands, outcomes and limits, or why none ran.")}`,
            `- **Gaps:** ${placeholder("Record verification_gap items, or state none.")}`,
        ],
        Verdict: [placeholder("Record the verdict followed by an em dash and its reason.")],
        "Summary and next step": [
            `- **Summary:** ${placeholder("Summarize the result and the strongest remaining limitation.")}`,
            `- **Next step:** ${placeholder("State the next action, if any.")}`,
        ],
    };
    return [placeholder("Add accepted findings here, or write No findings."),
        ...expectedSections(previousIds).map(name => `### ${name}\n\n${sections[name].join("\n")}`)].join("\n\n") + "\n";
}

function structuralLines(markdown, errors) {
    let fence;
    const lines = markdown.replace(/<!--[\s\S]*?-->/g, "").split(/\r\n?|\n/).filter(line => {
        const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
        if (fence) {
            if (marker?.[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) {
                fence = undefined;
            }
            return false;
        }
        if (marker && (marker[1][0] === "~" || !marker[2].includes("`"))) {
            fence = marker[1];
            return false;
        }
        return line.trim() !== "";
    });
    if (fence) {
        errors.push("Unclosed fenced code block.");
    }
    return lines;
}

function splitBlocks(lines, headingPattern) {
    const blocks = [{heading: "", lines: []}];
    for (const line of lines) {
        const heading = line.match(headingPattern)?.[1];
        if (heading) {
            blocks.push({heading, lines: []});
        } else {
            blocks.at(-1).lines.push(line);
        }
    }
    return blocks;
}

function readFields(lines, required, context, errors) {
    const fields = new Map();
    for (const line of lines) {
        const match = line.match(FIELD);
        if (!match || !required.includes(match[1])) {
            continue;
        }
        if (fields.has(match[1])) {
            errors.push(`${context}: duplicate ${match[1]}.`);
        }
        fields.set(match[1], match[2].trim());
    }
    for (const name of required) {
        if (!fields.has(name)) {
            errors.push(`${context}: missing ${name}.`);
        }
    }
    return fields;
}

function readFindings(lines, target, errors) {
    if (lines.length === 1 && lines[0] === "No findings.") {
        return [];
    }
    const [intro, ...blocks] = splitBlocks(lines, /^(#### .+)$/);
    if (intro.lines.length || !blocks.length) {
        errors.push("Start with finding headings or the exact line No findings.");
    }
    const findings = [];
    for (const {heading, lines: body} of blocks) {
        const match = heading.match(FINDING);
        if (!match) {
            errors.push("Invalid finding heading. Use #### F<number> [SEVERITY] title — path:line.");
            continue;
        }
        const [, id, severity] = match;
        const question = severity === "QUESTION";
        const defect = severity !== "QUESTION" && severity !== "SUGGESTION";
        const required = ["Behavior", "Impact", "Evidence", question ? "Needs decision" : "Fix direction", "Confidence"];
        if (target === "plan" && defect) {
            required.push("Actionable");
        }
        if (question) {
            required.push("Approval affecting");
        }
        const fields = readFields(body, required, id, errors);
        if (fields.has("Confidence") && !["high", "medium", "low"].includes(fields.get("Confidence"))) {
            errors.push(`${id}: Confidence must be high, medium or low.`);
        }
        for (const field of ["Actionable", "Approval affecting"].filter(name => fields.has(name))) {
            if (!["true", "false"].includes(fields.get(field))) {
                errors.push(`${id}: ${field} must be true or false.`);
            }
        }
        if (findings.some(finding => finding.id === id)) {
            errors.push(`Duplicate finding ID ${id}.`);
        }
        findings.push({id, severity, actionable: fields.get("Actionable") === "true",
            approvalAffecting: fields.get("Approval affecting") === "true"});
    }
    return findings;
}

function readResolutions(lines, previousIds, errors) {
    const resolutions = new Map();
    for (const line of lines) {
        const match = line.match(RESOLUTION);
        if (!match) {
            errors.push("Finding resolutions: use - F<number> — resolved|current|accepted — evidence.");
            continue;
        }
        const [, id, status, evidence] = match;
        const severity = status === "current" ? evidence.match(/^(BLOCKER|MAJOR|MINOR|QUESTION|SUGGESTION) — \S/)?.[1] : undefined;
        if (status === "current" && !severity) {
            errors.push(`Finding resolutions: ${id} requires current severity followed by evidence.`);
        }
        if (resolutions.has(id) || !previousIds.includes(id)) {
            errors.push(`Finding resolutions: duplicate or unexpected ID ${id}.`);
        }
        resolutions.set(id, {status, severity});
    }
    for (const id of previousIds.filter(id => !resolutions.has(id))) {
        errors.push(`Finding resolutions: missing ${id}.`);
    }
    return resolutions;
}

function checkVerdict(verdict, target, findings, errors) {
    const [blocked, changes, discuss, caveat, pass] = VERDICTS[target];
    const unresolved = target === "plan" ? findings.filter(finding => finding.actionable) : findings;
    const hasBlocker = unresolved.some(finding => finding.severity === "BLOCKER");
    const requiresChanges = unresolved.some(finding => finding.severity === "MAJOR"
        || (target === "plan" && finding.severity === "MINOR"));
    const requiresDiscussion = findings.some(finding => finding.approvalAffecting);
    if (verdict === "INCOMPLETE") {
        return;
    }
    if ((hasBlocker && verdict !== blocked) || (requiresChanges && ![blocked, changes].includes(verdict))
        || (requiresDiscussion && [pass, caveat].includes(verdict))
        || (verdict === pass && findings.some(finding => finding.severity === "MINOR"))) {
        errors.push("Verdict conflicts with the reported findings.");
    }
    if (target === "code" && ((verdict === blocked && !hasBlocker)
        || (verdict === changes && !requiresChanges)
        || (verdict === caveat && !findings.some(finding => finding.severity === "MINOR")))) {
        errors.push("Verdict requires a finding of the matching severity.");
    }
    if (![blocked, changes, discuss, caveat, pass].includes(verdict)) {
        errors.push(`Verdict: expected a ${target} verdict followed by an em dash and a reason.`);
    }
}

export function validateReviewReport(markdown, {target, previousIds = []}) {
    checkOptions(target, previousIds);
    const errors = [];
    if (markdown.includes(TODO)) {
        errors.push("Replace the remaining REVIEW_TODO placeholders.");
    }
    const [intro, ...blocks] = splitBlocks(structuralLines(markdown, errors), /^### (.+)$/);
    const sections = new Map(blocks.map(block => [block.heading.trim(), block.lines]));
    const expected = expectedSections(previousIds);
    if (blocks.map(block => block.heading.trim()).join("\n") !== expected.join("\n")) {
        errors.push(`Use these sections exactly once and in order: ${expected.join(", ")}.`);
    }
    for (const name of expected.filter(name => !sections.get(name)?.length)) {
        errors.push(`${name}: missing or empty section.`);
    }
    const findings = readFindings(intro.lines, target, errors);
    const resolutions = readResolutions(sections.get("Finding resolutions") ?? [], previousIds, errors);
    const targetFields = readFields(sections.get("Target") ?? [], ["Type", "Artifact and revision", "Scope", "Requirements"], "Target", errors);
    if (targetFields.get("Type") !== target) {
        errors.push(`Target: Type must be ${target}.`);
    }
    const coverage = sections.get("Coverage") ?? [];
    readFields(coverage, ["Omitted axes"], "Coverage", errors);
    if (!coverage.some(line => !line.startsWith("- **Omitted axes:**")
        && /\b(FINDING|REVIEWED|NOT_RELEVANT|NOT_COVERED)\b/.test(line))) {
        errors.push("Coverage: missing review entries.");
    }
    readFields(sections.get("Verification") ?? [], ["Checks", "Gaps"], "Verification", errors);
    const summary = readFields(sections.get("Summary and next step") ?? [], ["Summary", "Next step"], "Summary and next step", errors);
    if (intro.lines[0] === "No findings." && !summary.get("Summary")?.includes("No findings.")) {
        errors.push("Summary: repeat No findings. when there are no findings.");
    }
    const verdictLines = sections.get("Verdict");
    const verdict = verdictLines?.length === 1 ? verdictLines[0].match(/^([A-Z ]+) — \S.*$/)?.[1] : undefined;
    checkVerdict(verdict, target, findings, errors);
    return {ok: errors.length === 0, errors, findings, resolutions, verdict};
}

function main(args) {
    const {values, positionals} = parseArgs({args, allowPositionals: true, options: {
        target: {type: "string"}, previous: {type: "string"}, help: {type: "boolean", short: "h"},
    }});
    if (values.help) {
        process.stdout.write("Usage: review-report.mjs draft --target <code|plan> [--previous F1,F2]\n"
            + "       review-report.mjs validate --target <code|plan> [--previous F1,F2] <report.md>\n");
        return 0;
    }
    const options = {target: values.target, previousIds: values.previous?.split(",") ?? []};
    const [command, reportPath] = positionals;
    if (command === "draft" && positionals.length === 1) {
        process.stdout.write(draftReviewReport(options));
        return 0;
    }
    if (command === "validate" && positionals.length === 2) {
        const result = validateReviewReport(readFileSync(reportPath, "utf8"), options);
        if (result.ok) {
            process.stdout.write("REVIEW_REPORT_VALID\n");
            return 0;
        }
        process.stderr.write(`REVIEW_REPORT_INVALID\n${result.errors.join("\n")}\n`);
        return 1;
    }
    throw new Error("Expected draft or validate. Run review-report.mjs --help for usage.");
}

if (isMainModule(import.meta.url)) {
    try {
        process.exitCode = main(process.argv.slice(2));
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 2;
    }
}
