#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {isMainModule} from "../../../.agents/skills/_shared/scripts/is-main-module.mjs";
import {execFileSync} from "../../../.agents/skills/_shared/scripts/file-process.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
export const cases = JSON.parse(fs.readFileSync(path.join(directory, "cases.json"), "utf8"));
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");

/** Prepare isolated reviewer roots. Expected defects are never copied to them. */
export function prepareEvaluation({output, skillsRoot, label, profile}) {
    if (!label || !["harness", "model", "thinking", "mode"].every(key => typeof profile?.[key] === "string" && profile[key])) {
        throw new Error("A label and explicit harness/model/thinking/mode profile are required.");
    }
    const destination = path.resolve(output);
    fs.mkdirSync(destination); // Deliberately refuse overwriting an earlier run.
    const manifest = {label, profile, cases: []};
    for (const fixture of cases) {
        const root = path.join(destination, fixture.id);
        fs.mkdirSync(root);
        execFileSync("git", ["init", "--quiet", root]);
        fs.cpSync(skillsRoot, path.join(root, ".agents/skills"), {recursive: true});
        for (const [name, text] of Object.entries(fixture.files)) {
            fs.mkdirSync(path.dirname(path.join(root, name)), {recursive: true});
            fs.writeFileSync(path.join(root, name), text);
        }
        fs.writeFileSync(path.join(root, "AGENTS.md"), "# Evaluation repository\n\nRead-only review. Node.js ES modules. No application runtime or external service is required.\n");
        fs.writeFileSync(path.join(root, "source.md"), fixture.source + "\n");
        // Legacy presentation is intentional and identical in both arms; it does
        // not require migration to the new-plan formatting/difficulty contract.
        const plan = `---\nplan_id: v2-order-evaluation-1111aaaa\ncreated_at: 2026-01-01T00:00:00.000Z\nsource_artifact: source.md\n---\n${fixture.plan}`;
        fs.writeFileSync(path.join(root, "review-plan.md"), plan);
        fs.writeFileSync(path.join(root, "review-scope.json"), JSON.stringify({review_scope: "full", independent: true}));
        const skills = path.join(root, ".agents/skills");
        const taskPath = path.join(skills, "task-plan/references/external-review-task.md");
        const task = fs.readFileSync(taskPath, "utf8").replaceAll("<skills_root>", skills);
        const prompt = `Review the supplied legacy plan independently, using only this repository.\nBound inputs: source.md, review-plan.md, review-scope.json.\nThis fixture evaluates substantive readiness of a legacy plan; structural-validator execution is outside this evaluation.\nDo not access parent directories, other cases, oracle files, prior reports or evaluation tooling.\nRead-only commands are permitted. No external services are needed.\nReturn a JSON object with report_markdown and payload as specified below.\n\n${task}`;
        fs.writeFileSync(path.join(root, "prompt.md"), prompt);
        manifest.cases.push({id: fixture.id, root, prompt_sha256: hash(prompt),
            source_sha256: hash(fixture.source + "\n"), plan_sha256: hash(plan),
            method_sha256: hash(fs.readFileSync(path.join(skills, "code-review/references/plan-review.md")))});
    }
    // Keep run metadata outside individual reviewer roots, alongside the oracle.
    fs.writeFileSync(path.join(destination, "run.json"), JSON.stringify(manifest, null, 2) + "\n");
    return manifest;
}

/** Human adjudication is mandatory: no keyword matching or model self-grading. */
export function scoreEvaluation(run, annotations) {
    if (!Array.isArray(annotations) || annotations.length !== cases.length
        || new Set(annotations.map(row => row.case_id)).size !== cases.length) {
        throw new Error("Annotate each case exactly once, including the clean control.");
    }
    const scored = [];
    for (const fixture of cases) {
        const entry = annotations.find(row => row.case_id === fixture.id);
        const prepared = run.cases.find(row => row.id === fixture.id);
        if (!entry || !prepared) { throw new Error(`Missing case ${fixture.id}.`); }
        const bytes = fs.readFileSync(entry.report_path);
        if (entry.report_sha256 !== hash(bytes) || entry.prompt_sha256 !== prepared.prompt_sha256) {
            throw new Error(`Report/prompt hash mismatch: ${fixture.id}.`);
        }
        const report = JSON.parse(bytes);
        if (!Array.isArray(report.payload?.findings) || !Array.isArray(entry.findings)) {
            throw new Error(`Missing report findings or adjudication: ${fixture.id}.`);
        }
        const findings = report.payload.findings;
        if (new Set(findings.map(item => item.id)).size !== findings.length
            || entry.findings.length !== findings.length
            || new Set(entry.findings.map(item => item.report_id)).size !== findings.length) {
            throw new Error(`Adjudicate every reported finding exactly once: ${fixture.id}.`);
        }
        const expected = new Set(fixture.expected.map(item => item.id));
        const detected = new Set();
        let falsePositives = 0;
        let otherValid = 0;
        for (const finding of findings) {
            const judgment = entry.findings.find(item => item.report_id === finding.id);
            if (!judgment || typeof judgment.reason !== "string" || !judgment.reason.trim()
                || !Array.isArray(judgment.expected_ids)
                || judgment.expected_ids.some(id => !expected.has(id))) {
                throw new Error(`Invalid adjudication: ${fixture.id}/${finding.id}.`);
            }
            if (judgment.classification === "expected" && judgment.expected_ids.length > 0) {
                judgment.expected_ids.forEach(id => detected.add(id));
            } else if (["false_positive", "other_valid"].includes(judgment.classification) && judgment.expected_ids.length === 0) {
                // An unexpected real defect must not be mislabeled as a false positive.
                falsePositives += judgment.classification === "false_positive" ? 1 : 0;
                otherValid += judgment.classification === "other_valid" ? 1 : 0;
            } else { throw new Error(`Invalid classification: ${fixture.id}/${finding.id}.`); }
        }
        for (const key of ["elapsed_seconds", "cost_usd"]) {
            if (entry[key] !== null && (typeof entry[key] !== "number" || !Number.isFinite(entry[key]) || entry[key] < 0)) {
                throw new Error(`${key} must be a non-negative measurement or null.`);
            }
        }
        scored.push({case_id: fixture.id, detected: detected.size, expected: expected.size,
            false_positives: falsePositives, other_valid: otherValid,
            elapsed_seconds: entry.elapsed_seconds, cost_usd: entry.cost_usd});
    }
    const total = key => scored.reduce((sum, row) => sum + row[key], 0);
    const measuredTotal = key => scored.every(row => row[key] !== null) ? total(key) : null;
    return {label: run.label, profile: run.profile, cases: scored,
        detected: total("detected"), expected: total("expected"),
        recall: total("expected") ? total("detected") / total("expected") : null,
        false_positives: total("false_positives"), other_valid: total("other_valid"),
        elapsed_seconds: measuredTotal("elapsed_seconds"), cost_usd: measuredTotal("cost_usd")};
}

function main(argv) {
    if (argv.includes("--help") || argv.length === 0) {
        process.stdout.write("Usage:\n  evaluate.mjs prepare --output <new-directory> --skills-root <snapshot> --label <name> --profile <json-file>\n  evaluate.mjs score --run <run.json> --annotations <json-file>\nNo model calls, CI threshold or automatic semantic grading.\n");
        return;
    }
    const [command, ...args] = argv;
    const options = {};
    for (let index = 0; index < args.length; index += 2) {
        if (!args[index].startsWith("--") || !args[index + 1]) { throw new Error("Expected --option value pairs."); }
        options[args[index].slice(2)] = args[index + 1];
    }
    const read = name => JSON.parse(fs.readFileSync(options[name], "utf8"));
    const result = command === "prepare"
        ? prepareEvaluation({output: options.output, skillsRoot: path.resolve(options["skills-root"]), label: options.label, profile: read("profile")})
        : command === "score" ? scoreEvaluation(read("run"), read("annotations")) : null;
    if (!result) { throw new Error(`Unknown command: ${command}.`); }
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

if (isMainModule(import.meta.url)) {
    try { main(process.argv.slice(2)); } catch (error) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    }
}
