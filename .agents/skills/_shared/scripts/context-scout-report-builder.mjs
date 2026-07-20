#!/usr/bin/env node
import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, isAbsolute, relative, resolve} from "node:path";
import {validateScoutReport} from "./context-scout-report.mjs";
import {readCriteriaIds} from "./context-criteria.mjs";

const STATUSES = new Set(["COMPLETE", "INCOMPLETE", "BLOCKED"]);
const MODES = new Set(["targeted", "cross-layer"]);
const COVERAGE_STATUSES = new Set(["covered", "not_applicable", "blocked"]);
const ARTIFACT_ROOTS = [resolve(process.cwd(), "var/agent/cache"), resolve(tmpdir())];

function assertArtifactPath(filePath, label) {
    if (typeof filePath !== "string" || filePath.trim() === "") throw new Error(`${label} path is required`);
    const resolved = resolve(filePath);
    const allowed = ARTIFACT_ROOTS.some((root) => {
        const candidate = relative(root, resolved);
        return candidate === "" || (!candidate.startsWith("..") && !isAbsolute(candidate));
    });
    if (!allowed) throw new Error(`${label} must be under var/agent/cache or the system temporary directory`);
    return resolved;
}

function parseArgs(argv) {
    const [command, ledgerPath, ...rest] = argv;
    const options = {};
    for (let index = 0; index < rest.length; index += 1) {
        const argument = rest[index];
        if (!argument.startsWith("--")) {
            throw new Error(`unexpected argument: ${argument}`);
        }
        const key = argument.slice(2);
        const value = rest[index + 1];
        options[key] = value !== undefined && !value.startsWith("--") ? value : true;
        if (options[key] !== true) {
            index += 1;
        }
    }
    return {command, ledgerPath, options};
}

function requireValue(options, name) {
    const value = options[name];
    if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`missing --${name}`);
    }
    return value;
}

function readJson(path) {
    return JSON.parse(readFileSync(path, "utf8"));
}

function readLedger(path) {
    const ledger = readJson(assertArtifactPath(path, "ledger"));
    if (ledger?.version !== 1 || typeof ledger.head !== "string" || !Array.isArray(ledger.criteria)) {
        throw new Error("ledger must have version 1, head and criteria");
    }
    return ledger;
}

function writeLedger(path, ledger) {
    const artifactPath = assertArtifactPath(path, "ledger");
    mkdirSync(dirname(artifactPath), {recursive: true});
    writeFileSync(artifactPath, `${JSON.stringify(ledger, null, 2)}\n`);
}

function splitIds(value) {
    if (value === undefined || value === "") {
        return [];
    }
    return String(value).split(",").map((id) => id.trim()).filter(Boolean);
}

function nextId(prefix, items) {
    return `${prefix}${items.length + 1}`;
}

function evidenceFromLedger(ledger, ids) {
    return ids.map((id) => {
        const evidence = ledger.evidence.find((item) => item.id === id);
        if (!evidence) {
            throw new Error(`unknown evidence id: ${id}`);
        }
        const {id: ignored, ...value} = evidence;
        return value;
    });
}

function validateEvidenceNow(evidence, head) {
    const result = validateScoutReport({
        version: 1,
        status: "INCOMPLETE",
        mode: "targeted",
        findings: [{claim: "ledger evidence", evidence: [evidence]}],
        coverage: [],
        risks: [],
        omitted: [],
        next_step: "",
    }, {head});
    if (!result.valid) {
        throw new Error(result.errors.join("\n"));
    }
}

function validateLedgerReferences(ledger) {
    const criteria = new Set(ledger.criteria);
    const evidenceIds = new Set(ledger.evidence.map((item) => item.id));
    const checkCriterion = (criterionId) => {
        if (!criteria.has(criterionId)) {
            throw new Error(`unknown criterion id: ${criterionId}`);
        }
    };
    const checkEvidence = (ids) => {
        for (const id of ids) {
            if (!evidenceIds.has(id)) {
                throw new Error(`unknown evidence id: ${id}`);
            }
        }
    };

    ledger.findings.forEach((finding) => {
        checkCriterion(finding.criterion_id);
        if (typeof finding.claim !== "string" || finding.claim.trim() === "") {
            throw new Error(`finding ${finding.id} must have a non-empty claim`);
        }
        if (!Array.isArray(finding.evidence_ids) || finding.evidence_ids.length === 0) {
            throw new Error(`finding ${finding.id} must reference evidence`);
        }
        checkEvidence(finding.evidence_ids);
    });

    const seen = new Set();
    ledger.coverage.forEach((entry) => {
        checkCriterion(entry.criterion_id);
        if (seen.has(entry.criterion_id)) {
            throw new Error(`duplicate coverage criterion: ${entry.criterion_id}`);
        }
        seen.add(entry.criterion_id);
        if (!COVERAGE_STATUSES.has(entry.status)) {
            throw new Error(`invalid coverage status: ${entry.status}`);
        }
        checkEvidence(entry.evidence_ids ?? []);
        if (["not_applicable", "blocked"].includes(entry.status)
            && (typeof entry.reason !== "string" || entry.reason.trim() === "")) {
            throw new Error(`coverage ${entry.criterion_id} needs a reason`);
        }
    });
}

function buildReport(ledger, status, nextStep) {
    if (!STATUSES.has(status)) {
        throw new Error(`invalid status: ${status}`);
    }
    if (!MODES.has(ledger.mode)) {
        throw new Error(`invalid mode: ${ledger.mode}`);
    }
    validateLedgerReferences(ledger);
    const report = {
        version: 1,
        status,
        mode: ledger.mode,
        findings: ledger.findings.map((finding) => ({
            criterion_id: finding.criterion_id,
            claim: finding.claim,
            evidence: evidenceFromLedger(ledger, finding.evidence_ids),
        })),
        coverage: ledger.coverage.map((entry) => ({
            criterion_id: entry.criterion_id,
            status: entry.status,
            evidence: evidenceFromLedger(ledger, entry.evidence_ids ?? []),
            ...(entry.reason ? {reason: entry.reason} : {}),
        })),
        risks: ledger.risks,
        omitted: ledger.omitted,
        next_step: nextStep,
    };
    const validation = validateScoutReport(report, {
        head: ledger.head,
        criteria: new Set(ledger.criteria),
    });
    if (!validation.valid) {
        throw new Error(validation.errors.join("\n"));
    }
    return report;
}

function initLedger(ledgerPath, options) {
    const head = requireValue(options, "head");
    const criteriaIds = readCriteriaIds(requireValue(options, "criteria"));
    if (criteriaIds.length === 0) {
        throw new Error("missing acceptance criteria ids");
    }
    const mode = options.mode ?? "cross-layer";
    if (!MODES.has(mode)) {
        throw new Error(`invalid mode: ${mode}`);
    }
    const ledger = {
        version: 1,
        head,
        mode,
        criteria: criteriaIds,
        evidence: [],
        findings: [],
        coverage: [],
        risks: [],
        omitted: [],
        next_step: "",
    };
    writeLedger(ledgerPath, ledger);
    process.stdout.write(`${ledgerPath}\n`);
}

function addEvidence(ledgerPath, options) {
    const ledger = readLedger(ledgerPath);
    const evidence = {
        path: requireValue(options, "path"),
        line_start: Number(requireValue(options, "line-start")),
        line_end: Number(requireValue(options, "line-end")),
    };
    if (options.locator !== undefined) evidence.locator = String(options.locator);
    if (options.relation !== undefined) evidence.relation = String(options.relation);
    validateEvidenceNow(evidence, ledger.head);
    const existing = ledger.evidence.find((item) => JSON.stringify({...item, id: undefined}) === JSON.stringify(evidence));
    if (existing) {
        process.stdout.write(`${existing.id}\n`);
        return;
    }
    const id = nextId("E", ledger.evidence);
    ledger.evidence.push({id, ...evidence});
    writeLedger(ledgerPath, ledger);
    process.stdout.write(`${id}\n`);
}

function addFinding(ledgerPath, options) {
    const ledger = readLedger(ledgerPath);
    const evidenceIds = splitIds(requireValue(options, "evidence"));
    const finding = {
        id: nextId("F", ledger.findings),
        criterion_id: requireValue(options, "criterion"),
        claim: requireValue(options, "claim"),
        evidence_ids: evidenceIds,
    };
    validateLedgerReferences({...ledger, findings: [...ledger.findings, finding]});
    ledger.findings.push(finding);
    writeLedger(ledgerPath, ledger);
    process.stdout.write(`${finding.id}\n`);
}

function setCoverage(ledgerPath, options) {
    const ledger = readLedger(ledgerPath);
    const criterionId = requireValue(options, "criterion");
    const entry = {
        criterion_id: criterionId,
        status: requireValue(options, "status"),
        evidence_ids: splitIds(options.evidence),
    };
    if (options.reason !== undefined) entry.reason = String(options.reason);
    ledger.coverage = ledger.coverage.filter((item) => item.criterion_id !== criterionId);
    validateLedgerReferences({...ledger, coverage: [...ledger.coverage, entry]});
    ledger.coverage.push(entry);
    writeLedger(ledgerPath, ledger);
}

function appendText(ledgerPath, key, value) {
    const ledger = readLedger(ledgerPath);
    ledger[key].push(requireValue({text: value}, "text"));
    writeLedger(ledgerPath, ledger);
}

function main(argv) {
    const {command, ledgerPath, options} = parseArgs(argv);
    if (!command || !ledgerPath) {
        throw new Error("Usage: context-scout-report-builder.mjs <init|add-evidence|add-finding|set-coverage|add-risk|add-omitted|set-next-step|check|render> <ledger.json> ...");
    }
    if (command === "init") return initLedger(ledgerPath, options);
    if (command === "add-evidence") return addEvidence(ledgerPath, options);
    if (command === "add-finding") return addFinding(ledgerPath, options);
    if (command === "set-coverage") return setCoverage(ledgerPath, options);
    if (command === "add-risk") return appendText(ledgerPath, "risks", options.text);
    if (command === "add-omitted") return appendText(ledgerPath, "omitted", options.text);
    if (command === "set-next-step") {
        const ledger = readLedger(ledgerPath);
        ledger.next_step = requireValue(options, "text");
        writeLedger(ledgerPath, ledger);
        return;
    }
    if (command === "check") {
        const ledger = readLedger(ledgerPath);
        buildReport(ledger, "INCOMPLETE", ledger.next_step);
        process.stdout.write("ledger valid\n");
        return;
    }
    if (command === "render") {
        const ledger = readLedger(ledgerPath);
        const report = buildReport(ledger, options.status ?? "COMPLETE", ledger.next_step);
        const output = options.output;
        if (typeof output === "string" && output !== "") {
            const outputPath = assertArtifactPath(output, "report output");
            mkdirSync(dirname(outputPath), {recursive: true});
            writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
        } else {
            process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        }
        return;
    }
    throw new Error(`unknown command: ${command}`);
}

try {
    main(process.argv.slice(2));
} catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
}
