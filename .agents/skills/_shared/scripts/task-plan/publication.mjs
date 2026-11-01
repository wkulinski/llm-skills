#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";

import {assertPersistentAgentPath, assertRepositoryFilePath, resolvePersistentAgentRoot} from "../artifact-path.mjs";
import {isMainModule} from "../is-main-module.mjs";
import {detectSecrets} from "../secret-detector.mjs";
import {writeFileAtomic} from "./atomic-file.mjs";
import {resolvePlanPaths, StoreError} from "./store.mjs";
import {buildPlanId, loadPersistedSource} from "./source.mjs";
import {parseExecutionContract, parsePlanDocument} from "./validate.mjs";

export const PUBLICATION_SCHEMA_VERSION = 1;
export const PUBLICATION_RULES_VERSION = 1;
const statuses = ["current", "historical", "requires-reassessment"];
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function fail(code, message, details = {}) {
    throw new StoreError(code, message, details);
}

function text(value, label) {
    if (typeof value !== "string" || !value.trim()) {
        fail("INVALID_ARGUMENT", `${label} must be a non-empty string.`);
    }
    return value;
}

function list(value, label) {
    if (!Array.isArray(value)) { fail("INVALID_ARGUMENT", `${label} must be an explicit array (use [] for none).`); }
    return value;
}

function repoPath(root, value) {
    text(value, "source path");
    if (path.isAbsolute(value) || value.includes("\\") || value.split("/").includes("..")) {
        fail("UNSAFE_PATH", "Use repository-relative paths without parent traversal.");
    }
    return assertRepositoryFilePath(value.replace(/^\.\//, ""), root);
}

export function parseIssueUrl(value) {
    const match = text(value, "issue URL").match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/issues\/([1-9][0-9]*)\/?$/);
    if (!match || [".", ".."].includes(match[1]) || [".", ".."].includes(match[2]) || !Number.isSafeInteger(Number(match[3]))) {
        fail("INVALID_ARGUMENT", "An explicit full https://github.com/owner/repo/issues/number URL is required.");
    }
    const repository = `${match[1]}/${match[2]}`.toLowerCase();
    return {repository, number: Number(match[3]), url: `https://github.com/${repository}/issues/${match[3]}`};
}

export function publicationContext({repoRoot = process.cwd(), planPath} = {}) {
    const root = path.resolve(repoRoot);
    const absolute = repoPath(root, planPath);
    const markdown = fs.readFileSync(absolute, "utf8");
    const parsed = parsePlanDocument(markdown);
    const sourceIdentity = text(parsed.metadata.source_identity, "source_identity");
    const paths = resolvePlanPaths({repoRoot: root, sourceIdentity});
    if (absolute !== paths.draftPath) { fail("NON_CANONICAL_PLAN_PATH", "Plan path does not match its source identity."); }
    const planId = buildPlanId(sourceIdentity);
    if (parsed.errors.length || parsed.metadata.plan_id !== planId) {
        fail("PUBLICATION_IDENTITY_CONFLICT", "Plan metadata does not match its canonical source.");
    }
    // Technical evidence is not a rendering prerequisite. When available, source identity still gets checked.
    const issueIdentity = sourceIdentity.match(/^([^/#]+)\/([^/#]+)#([1-9][0-9]*)$/);
    const source = fs.existsSync(paths.sourcePath) ? loadPersistedSource({repoRoot: root, sourceIdentity}).source
        : issueIdentity ? {source_kind: "github-issue", owner: issueIdentity[1], repo: issueIdentity[2], issue_number: Number(issueIdentity[3])}
            : {identity: sourceIdentity};
    const loaded = {markdown, metadata: parsed.metadata, source: {source}};
    const recordPath = assertPersistentAgentPath("task-plan", path.join(root, "var/agent/task-plan", planId, "publication.json"), root);
    return {root, absolute, recordPath, loaded, planHash: hash(fs.readFileSync(absolute)), identity: {
        plan_id: planId,
        source_identity: sourceIdentity,
        plan_path: path.relative(root, absolute).split(path.sep).join("/"),
    }};
}

function readRecord(context) {
    try {
        const bytes = fs.readFileSync(context.recordPath);
        const record = JSON.parse(bytes);
        if (record.schema_version !== PUBLICATION_SCHEMA_VERSION || JSON.stringify(record.plan) !== JSON.stringify(context.identity)
            || !record.issue || JSON.stringify(parseIssueUrl(record.issue.url)) !== JSON.stringify(record.issue)) {
            fail("PUBLICATION_IDENTITY_CONFLICT", "Publication record schema or identity does not match this plan.");
        }
        return {record, base: hash(bytes)};
    } catch (error) {
        if (error.code === "ENOENT") { return {record: null, base: null}; }
        throw error;
    }
}

export function loadPublication(options) {
    const context = publicationContext(options);
    return {...readRecord(context), context};
}

/** One lock and compare-and-swap boundary for bind, assess and publisher writes. */
export function updatePublication(context, transform, {expectedBase, writeAtomic = writeFileAtomic} = {}) {
    const initial = readRecord(context);
    if (expectedBase !== undefined && expectedBase !== initial.base) {
        fail("PUBLICATION_CONFLICT", "Publication record changed; reload before retrying.");
    }
    const lock = assertPersistentAgentPath("task-plan", `${context.recordPath}.lock`, context.root);
    fs.mkdirSync(path.dirname(lock), {recursive: true});
    let descriptor;
    try {
        descriptor = fs.openSync(lock, "wx");
    } catch (error) {
        if (error.code === "EEXIST") { fail("PUBLICATION_LOCKED", "Publication is locked; finish or reconcile the other writer before retrying."); }
        throw error;
    }
    try {
        const current = readRecord(context);
        if (current.base !== initial.base) { fail("PUBLICATION_CONFLICT", "Publication record changed while acquiring its lock."); }
        const checkpoint = (record) => {
            if (hash(fs.readFileSync(context.absolute)) !== context.planHash || readRecord(context).base !== current.base) {
                fail("PUBLICATION_CONFLICT", "Inputs changed before publication checkpoint.");
            }
            writeAtomic(context.recordPath, json(record), {rootDir: context.root});
            current.base = hash(json(record));
        };
        const record = transform(current.record, {checkpoint});
        if (hash(fs.readFileSync(context.absolute)) !== context.planHash) {
            fail("PUBLICATION_CONFLICT", "Plan changed during this operation; reload before retrying.");
        }
        // Recheck the base even for callers doing work inside the transaction.
        if (readRecord(context).base !== current.base) { fail("PUBLICATION_CONFLICT", "Publication record changed during this operation."); }
        const contents = json(record);
        if (hash(contents) !== current.base) { writeAtomic(context.recordPath, contents, {rootDir: context.root}); }
        return {ok: true, record, base: hash(contents)};
    } finally {
        fs.closeSync(descriptor);
        fs.unlinkSync(lock);
    }
}

export function bindPublication({issueUrl, ...options} = {}) {
    const context = publicationContext(options);
    const issue = parseIssueUrl(issueUrl);
    const source = context.loaded.source.source;
    if (source.source_kind === "github-issue"
        && (`${source.owner}/${source.repo}`.toLowerCase() !== issue.repository || source.issue_number !== issue.number)) {
        fail("PUBLICATION_IDENTITY_CONFLICT", "Issue does not match the plan's GitHub source.");
    }
    return updatePublication(context, (record) => {
        if (record && JSON.stringify(record.issue) !== JSON.stringify(issue)) {
            fail("PUBLICATION_IDENTITY_CONFLICT", "Plan is already bound to another issue; reconcile explicitly rather than overwriting.");
        }
        return record ?? {schema_version: PUBLICATION_SCHEMA_VERSION, rules_version: PUBLICATION_RULES_VERSION,
            plan: context.identity, issue, assessment: null, outputs: {}, intent: null};
    }, options);
}

export function assertOutputName(name) {
    if (typeof name !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.md$/.test(name)
        || ["plan.md", "readme.md", "plan.original.md"].includes(name.toLowerCase())) {
        fail("INVALID_MATERIAL", "Additional outputs must be flat Markdown filenames, not plan.md, README.md or plan.original.md.");
    }
    return name;
}

function sourcePath(root, value) {
    return path.relative(root, repoPath(root, value)).split(path.sep).join("/");
}

// Only direct report references in the body are candidates, never a recursive artifact graph.
export function directReportPaths(markdown) {
    let body = "";
    outsideFences(parsePlanDocument(markdown).body, (chunk) => { body += chunk; return chunk; });
    return [...new Set([...body.matchAll(/(?:\.\/)?(?:var|docs)\/[A-Za-z0-9_./-]+\.(?:md|json)\b/g)]
        .map(([value]) => value.replace(/^\.\//, ""))
        .filter((value) => /(?:report|review|receipt|acceptance|wp[0-9])/i.test(value)
            && !/(?:\/evidence\/|\/context[^/]*\/|ledger|manifest|criteria|source\.json)/i.test(value)))].sort();
}

function normalizeAssessment(input, context) {
    if (!input || typeof input !== "object" || Array.isArray(input) || input.confirm_current_inputs !== true) {
        fail("ASSESSMENT_CONFIRMATION_REQUIRED", "assess requires confirm_current_inputs: true for the current plan, rules and sources.");
    }
    const sources = list(input.sources, "sources").map((source) => {
        const filename = sourcePath(context.root, source.path);
        if (!["omitted", "summary", "material"].includes(source.disposition) || !statuses.includes(source.status)) {
            fail("INVALID_ASSESSMENT", "Every source needs disposition omitted|summary|material and status current|historical|requires-reassessment.");
        }
        return {path: filename, disposition: source.disposition, status: source.status, reason: text(source.reason, "source reason"),
            sha256: hash(fs.readFileSync(repoPath(context.root, filename)))};
    }).sort((a, b) => a.path.localeCompare(b.path, "en"));
    if (new Set(sources.map((source) => source.path)).size !== sources.length) { fail("INVALID_ASSESSMENT", "Duplicate assessment sources."); }
    for (const report of directReportPaths(context.loaded.markdown)) {
        if (!sources.some((source) => source.path === report)) { fail("ASSESSMENT_SOURCE_REQUIRED", `Direct report requires assessment (including omissions): ${report}`); }
    }
    const normalizeText = (entry) => {
        if (!statuses.includes(entry.status)) { fail("INVALID_ASSESSMENT", "Every finding requires an explicit status."); }
        const paths = list(entry.source_paths, "source_paths").map((value) => sourcePath(context.root, value)).sort();
        if (paths.some((value) => !sources.some((source) => source.path === value))) {
            fail("INVALID_ASSESSMENT", "All finding sources must be assessed, including omitted duplicates.");
        }
        if (entry.wp_id !== undefined && !/^WP[1-9][0-9]*$/.test(entry.wp_id)) { fail("INVALID_ASSESSMENT", "Invalid wp_id."); }
        return {text: text(entry.text, "finding text"), status: entry.status, source_paths: paths,
            ...(entry.wp_id ? {wp_id: entry.wp_id} : {})};
    };
    const summaries = list(input.summaries, "summaries").map(normalizeText);
    const replacements = list(input.replacements, "replacements").map((entry) => ({reference: text(entry.reference, "reference"), ...normalizeText(entry)}));
    if (new Set(replacements.map((entry) => entry.reference)).size !== replacements.length) { fail("INVALID_ASSESSMENT", "Duplicate replacement references."); }
    const materials = list(input.materials, "materials").map((entry) => {
        const name = assertOutputName(entry.name);
        const source = sourcePath(context.root, entry.source_path);
        const assessed = sources.find((item) => item.path === source);
        if (!assessed || assessed.disposition !== "material" || entry.kind !== "report") {
            fail("INVALID_MATERIAL", "Only explicitly assessed report materials may be additional outputs.");
        }
        if (/^(?:\.agents|\.claude|\.opencode|src|tests)\//.test(source) || /^docs\/plans\//.test(source)
            || /(?:source\.json|ledger|manifest|criteria|state|session|\/evidence\/|\/qa-run\/|SKILL\.md|AGENTS\.md|README\.md|standard|profile|\.env)/i.test(source)
            || entry.duplicate !== false || entry.available_in_project !== false || entry.technical !== false) {
            fail("INVALID_MATERIAL", "Duplicates, project/upstream content, norms and technical artifacts cannot be additional materials.");
        }
        const justification = Object.fromEntries(["essential", "unique", "summary_insufficient"].map((key) => [key, text(entry.justification?.[key], `justification.${key}`)]));
        return {name, source_path: source, justification, ...normalizeText(entry)};
    }).sort((a, b) => a.name.localeCompare(b.name, "en"));
    if (new Set(materials.map((entry) => entry.name.toLowerCase())).size !== materials.length) { fail("INVALID_MATERIAL", "Duplicate output names."); }
    if (new Set(materials.map((entry) => entry.source_path)).size !== materials.length) { fail("INVALID_MATERIAL", "A material source may only be selected once."); }
    const selection = {summaries, replacements, materials};
    return {plan_sha256: context.planHash, rules_version: PUBLICATION_RULES_VERSION, sources,
        selection, selection_sha256: hash(json(selection))};
}

export function assessPublication({input, ...options} = {}) {
    const context = publicationContext(options);
    return updatePublication(context, (record) => {
        if (!record) { fail("PUBLICATION_NOT_BOUND", "Run bind with the canonical plan and explicit issue URL first."); }
        const assessment = normalizeAssessment(input, context);
        // Spread preserves output hashes and unresolved intent; assessment never adopts current output bytes.
        return {...record, rules_version: PUBLICATION_RULES_VERSION, assessment};
    }, options);
}

export function checkAssessment(context, record) {
    const assessment = record?.assessment;
    const reasons = [];
    if (!assessment) { return {current: false, reasons: ["assessment missing"]}; }
    if (assessment.plan_sha256 !== hash(fs.readFileSync(context.absolute))) { reasons.push("plan changed"); }
    if (record.rules_version !== PUBLICATION_RULES_VERSION || assessment.rules_version !== PUBLICATION_RULES_VERSION) { reasons.push("rules changed"); }
    if (assessment.selection_sha256 !== hash(json(assessment.selection))) { reasons.push("selection changed"); }
    for (const source of assessment.sources) {
        try {
            if (source.sha256 !== hash(fs.readFileSync(repoPath(context.root, source.path)))) { reasons.push(`source changed: ${source.path}`); }
        } catch (error) {
            if (error.code !== "ENOENT") { throw error; }
            reasons.push(`source unavailable: ${source.path}`);
        }
    }
    return {current: reasons.length === 0, reasons};
}

function outsideFences(markdown, transform) {
    let fence = null;
    let normal = "";
    let result = "";
    for (const line of markdown.split(/(?<=\n)/)) {
        const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
        if (fence) {
            result += line;
            if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && /^ {0,3}(?:`+|~+)\s*$/.test(line)) { fence = null; }
        } else if (marker) {
            result += transform(normal) + line;
            normal = "";
            fence = marker[1];
        } else { normal += line; }
    }
    return result + transform(normal);
}

function statusText(entry, execution) {
    const wp = entry.wp_id && execution.find((item) => item.id === entry.wp_id);
    if (entry.wp_id && !wp) { fail("INVALID_ASSESSMENT", `Finding names unknown ${entry.wp_id}.`); }
    if (wp && !wp.completed && entry.status === "current") {
        fail("ASSESSMENT_REOPENED_WP", `${entry.wp_id} is open; explicitly classify earlier findings as historical or requires-reassessment.`);
    }
    return entry.status === "current" ? entry.text : `[${entry.status}] ${entry.text}`;
}

/** Pure rendering: callers supply the exact source bytes and versioned project path inventory. */
export function renderPublication({markdown, record, sourceContents = {}, projectFiles = []} = {}) {
    const parsed = parsePlanDocument(text(markdown, "markdown"));
    if (parsed.errors.length || parsed.metadata.plan_id !== record?.plan?.plan_id || parsed.metadata.source_identity !== record.plan.source_identity) {
        fail("PUBLICATION_IDENTITY_CONFLICT", "Renderer requires the canonical plan identity and valid managed front matter.");
    }
    const assessment = record.assessment;
    if (!assessment || assessment.plan_sha256 !== hash(markdown) || assessment.rules_version !== PUBLICATION_RULES_VERSION
        || record.rules_version !== PUBLICATION_RULES_VERSION || assessment.selection_sha256 !== hash(json(assessment.selection))) {
        fail("ASSESSMENT_STALE", "Confirm the assessment for the current plan, selection and publication rules before rendering.");
    }
    for (const source of assessment.sources) {
        if (!Object.hasOwn(sourceContents, source.path) || hash(sourceContents[source.path]) !== source.sha256) {
            fail("ASSESSMENT_STALE", `Assessed source is missing or changed: ${source.path}`);
        }
    }
    const selection = assessment.selection;
    const execution = parseExecutionContract(parsed.body).items;
    const destination = `docs/plans/issue-${record.issue.number}`;
    const tracked = new Set(projectFiles);
    const replacements = new Map(selection.replacements.map((entry) => [entry.reference, entry]));
    const localTrace = (value) => /^(?:var\/|\.agents\/|\.claude\/|\.opencode\/|docs\/plans\/v2-|docs\/drafts\/)/.test(value);
    const tooling = (value) => /(?:source\.json|ledger|manifest|criteria|context[^/]*\.(?:json|md)|\/evidence\/|\/qa-run\/|\/state\.md|read-events\.jsonl)/i.test(value);
    function resolveReference(reference, origin) {
        const explicit = replacements.get(reference);
        if (explicit) { return {replacement: statusText(explicit, execution)}; }
        if (/^(?:https?:|mailto:|#)/i.test(reference)) { return {target: reference}; }
        if (/^[a-z][a-z0-9+.-]*:/i.test(reference)) { fail("UNRESOLVED_REFERENCE", `Unsupported link protocol: ${reference}`); }
        let decoded;
        try { decoded = decodeURIComponent(reference); } catch { fail("UNRESOLVED_REFERENCE", `Invalid link: ${reference}`); }
        const [filename, fragment = ""] = decoded.split(/(?=[#?])/s);
        // A leading repo directory means a repo-relative textual path. Markdown ./ and ../ remain document-relative.
        const relative = /^(?:var|docs|src|tests|\.agents|\.claude|\.opencode)\//.test(filename)
            ? filename : path.posix.normalize(path.posix.join(path.posix.dirname(origin), filename));
        const normalized = relative.replace(/^\.\//, "");
        const byPath = replacements.get(normalized);
        if (byPath) { return {replacement: statusText(byPath, execution)}; }
        if (normalized.startsWith("../") || path.posix.isAbsolute(normalized) || normalized.includes("\\")) {
            fail("UNRESOLVED_REFERENCE", `Link escapes the repository: ${reference}`);
        }
        if (tracked.has(normalized) && !normalized.startsWith("var/")) {
            return {target: `${path.posix.relative(destination, normalized)}${fragment}`};
        }
        if (localTrace(normalized) && tooling(normalized)) { return {replacement: ""}; }
        fail("UNRESOLVED_REFERENCE", `Provide an assessed replacement or known versioned upstream for ${reference}.`);
    }
    function transformLinks(content, origin) {
        const definitions = new Map();
        outsideFences(content, (chunk) => {
            for (const match of chunk.matchAll(/^ {0,3}\[([^\]]+)\]:\s*<?([^\s>]+)>?(?:[^\n]*)$/gm)) {
                definitions.set(match[1].toLowerCase(), resolveReference(match[2], origin));
            }
            return chunk;
        });
        return outsideFences(content, (inputChunk) => {
            let chunk = inputChunk;
            const protectedParts = [];
            const protect = (value) => { protectedParts.push(value); return `\u0000PUB${protectedParts.length - 1}\u0000`; };
            chunk = chunk.replace(/^ {0,3}\[([^\]]+)\]:\s*<?([^\s>]+)>?(?:[^\n]*)$/gm, (whole, id, target) => {
                const resolution = definitions.get(id.toLowerCase());
                return resolution.target ? protect(whole.replace(target, resolution.target)) : "";
            });
            chunk = chunk.replace(/\[([^\]]+)\]\[([^\]]*)\]/g, (whole, label, id) => {
                const resolution = definitions.get((id || label).toLowerCase());
                return resolution && "replacement" in resolution ? protect(resolution.replacement || label) : whole;
            });
            chunk = chunk.replace(/\[([^\]]+)\](?![([])/g, (whole, label) => {
                const resolution = definitions.get(label.toLowerCase());
                return resolution && "replacement" in resolution ? protect(resolution.replacement || label) : whole;
            });
            chunk = chunk.replace(/!?\[([^\]]*)\]\(<?([^\s)>]+)>?(?:\s+"[^"]*")?\)/g, (whole, label, target) => {
                const resolution = resolveReference(target, origin);
                return protect("replacement" in resolution ? (resolution.replacement || label) : whole.replace(target, resolution.target));
            });
            chunk = chunk.replace(/<a\b([^>]*?)href=(?:"([^"]+)"|'([^']+)'|([^\s>]+))([^>]*)>([\s\S]*?)<\/a>/gi, (whole, before, doubleQuoted, singleQuoted, unquoted, after, label) => {
                const target = doubleQuoted ?? singleQuoted ?? unquoted;
                const resolution = resolveReference(target, origin);
                return protect("replacement" in resolution ? (resolution.replacement || label) : `<a${before}href="${resolution.target}"${after}>${label}</a>`);
            });
            chunk = chunk.replace(/\b(href|src)=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi, (whole, attribute, doubleQuoted, singleQuoted, unquoted) => {
                const target = doubleQuoted ?? singleQuoted ?? unquoted;
                const resolution = resolveReference(target, origin);
                if ("replacement" in resolution) { fail("UNRESOLVED_REFERENCE", "Replace the whole local HTML element explicitly in the assessment."); }
                return protect(`${attribute}="${resolution.target}"`);
            });
            // Bare local traces (including inline code) must not survive outside fenced examples.
            chunk = chunk.replace(/`?((?:\.\/)?(?:var|\.agents|\.claude|\.opencode|docs\/drafts|docs\/plans\/v2-[A-Za-z0-9_-]+)\/[A-Za-z0-9_./-]+)`?/g, (whole, reference) => {
                // Do not match the suffix of a freshly rebased project URL.
                const resolution = resolveReference(reference, origin);
                return "replacement" in resolution ? resolution.replacement : (whole.startsWith("`") ? `\`${resolution.target}\`` : resolution.target);
            });
            return chunk.replace(/\u0000PUB([0-9]+)\u0000/g, (_, index) => protectedParts[Number(index)]);
        });
    }
    let body = outsideFences(parsed.body, (chunk) => chunk
        .replace(/^## Execution environment\s*\n[\s\S]*?(?=^## |$(?![\s\S]))/gm, "")
        .replace(/^- Difficulty:[^\n]*\n(?:^[ \t]+[^\n]*\n)*/gm, "")
        .replace(/^- (?:Estimated size|Profile rationale|Default model|Default reasoning|WP overrides):[^\n]*(?:\n|$)/gm, ""));
    body = transformLinks(body, record.plan.plan_path);
    for (const summary of selection.summaries) {
        const value = transformLinks(statusText(summary, execution), record.plan.plan_path);
        if (body.includes(value)) { continue; }
        if (summary.wp_id) {
            const header = new RegExp(`(^### ${summary.wp_id} [^\\n]+\\n)`, "m");
            if (!header.test(body)) { fail("INVALID_ASSESSMENT", `No work-package heading for ${summary.wp_id}.`); }
            body = body.replace(header, `$1\n${value}\n`);
        } else { body += `\n${value}\n`; }
    }
    const outputs = {};
    const materialHashes = new Set([hash(markdown)]);
    for (const material of selection.materials) {
        assertOutputName(material.name);
        if (Object.hasOwn(outputs, material.name)) { fail("INVALID_MATERIAL", "Duplicate output names."); }
        const content = sourceContents[material.source_path];
        if (typeof content !== "string") { fail("ASSESSMENT_STALE", `Material unavailable: ${material.source_path}`); }
        if (tracked.has(material.source_path) || materialHashes.has(hash(content))) {
            fail("INVALID_MATERIAL", "Do not copy versioned project content, the canonical plan or duplicate material bytes.");
        }
        materialHashes.add(hash(content));
        outputs[material.name] = transformLinks(content, material.source_path);
        body += `\n[${material.name}](${material.name}) — ${statusText(material, execution)} ${material.justification.essential}\n`;
    }
    const header = `> Snapshot — kopia do czytania, nie plan wykonawczy.\n> Issue: ${record.issue.url}\n> Plan źródłowy: \`${record.plan.plan_id}\`\n\n`;
    const rendered = {"plan.md": `${header}${body.trim()}\n`, ...outputs};
    for (const content of Object.values(rendered)) {
        outsideFences(content, (chunk) => {
            const prose = chunk.replace(/https?:\/\/[^\s<>]+/g, "");
            if (/(?:^|[\s`"'(<\/])var\//m.test(prose)) {
                fail("UNRESOLVED_REFERENCE", "Rendered content still contains a local work-state reference, including assessed replacement text. Correct the assessment.");
            }
            return chunk;
        });
    }
    return rendered;
}

function git(root, args, input) {
    const result = spawnSync("git", args, {cwd: root, encoding: "utf8", input});
    if (result.error || result.signal || ![0, 1].includes(result.status)) {
        fail("PUBLICATION_GIT_FAILED", "Could not inspect versioned paths/ignore rules; verify the Git repository.");
    }
    return result;
}

function assertFresh(context, record) {
    const result = checkAssessment(context, record);
    if (!result.current) { fail("ASSESSMENT_STALE", "Run assess with explicit confirmation/correction for current inputs before publishing.", {reasons: result.reasons}); }
}

function outputPath(context, issue, name) {
    if (name !== "plan.md") { assertOutputName(name); }
    return assertRepositoryFilePath(path.join(context.root, "docs/plans", `issue-${issue.number}`, name), context.root);
}

function actualHash(filename) {
    try { return hash(fs.readFileSync(filename)); }
    catch (error) { if (error.code === "ENOENT") { return null; } throw error; }
}

function hashesEqual(left, right) {
    return JSON.stringify(Object.entries(left).sort()) === JSON.stringify(Object.entries(right).sort());
}

function outputConflict(message) {
    fail("PUBLICATION_OUTPUT_CONFLICT", `${message} Stop and explicitly reconcile the publication and local record; automatic force/adoption is not supported.`);
}

function validateOutputHashes(context, record, desired) {
    if (!record.outputs || Array.isArray(record.outputs) || typeof record.outputs !== "object") {
        outputConflict("Invalid managed output state.");
    }
    const after = {...record.outputs, ...desired};
    const before = Object.fromEntries(Object.keys(after).map((name) => [name, record.outputs[name] ?? null]));
    if (record.intent && (!hashesEqual(record.intent.before ?? {}, before) || !hashesEqual(record.intent.after ?? {}, after))) {
        outputConflict("Unresolved intent belongs to different output bytes. Restore its confirmed inputs before retrying.");
    }
    for (const [name, expected] of Object.entries(after)) {
        if (!/^[a-f0-9]{64}$/.test(expected) || (before[name] !== null && !/^[a-f0-9]{64}$/.test(before[name]))) {
            outputConflict("Invalid output hash.");
        }
        const filename = outputPath(context, record.issue, name);
        const actual = actualHash(filename);
        if (actual !== before[name] && (!record.intent || actual !== after[name])) {
            outputConflict(`Unrecognized/missing/edited output: ${name}.`);
        }
        if (name === "plan.md" && actual !== null) {
            const content = fs.readFileSync(filename, "utf8");
            if (!content.startsWith(`> Snapshot — kopia do czytania, nie plan wykonawczy.\n> Issue: ${record.issue.url}\n> Plan źródłowy: \`${record.plan.plan_id}\`\n`)) {
                outputConflict("Existing snapshot names another issue or canonical plan.");
            }
        }
    }
    return {before, after};
}

function preparePublication(context, record) {
    if (!record) { fail("PUBLICATION_NOT_BOUND", "Local binding is missing. Existing snapshots cannot be adopted; explicitly reconcile before publishing."); }
    assertFresh(context, record);
    const sourceContents = Object.fromEntries(record.assessment.sources.map((source) => [source.path, fs.readFileSync(repoPath(context.root, source.path), "utf8")]));
    const files = git(context.root, ["ls-files", "-z"]);
    if (files.status !== 0) { fail("PUBLICATION_GIT_FAILED", "Could not read the versioned project inventory."); }
    const outputs = renderPublication({markdown: context.loaded.markdown, record, sourceContents, projectFiles: files.stdout.split("\0").filter(Boolean)});
    if (detectSecrets(outputs).length) { fail("PUBLICATION_SECRET", "Publication output appears to contain a secret; remove it before publishing (contents withheld)."); }
    const names = Object.keys(outputs);
    const paths = names.map((name) => outputPath(context, record.issue, name));
    const ignored = git(context.root, ["check-ignore", "--no-index", "-z", "--stdin"], paths.map((filename) => path.relative(context.root, filename)).join("\0") + "\0");
    if (ignored.status === 0) { fail("PUBLICATION_IGNORED", "Publication is ignored by Git. Correct .gitignore explicitly; publish will not edit it or use git add -f."); }
    const desired = Object.fromEntries(names.map((name) => [name, hash(outputs[name])]));
    const transaction = validateOutputHashes(context, record, desired);
    const changed = names.filter((name) => actualHash(outputPath(context, record.issue, name)) !== desired[name]);
    return {outputs, desired, transaction, changed};
}

export function checkPublication(options = {}) {
    const {context, record} = loadPublication(options);
    const prepared = preparePublication(context, record);
    return {ok: true, current: true, changed: prepared.changed, recovery: Boolean(record.intent)};
}

export function publishPlan(options = {}) {
    const {context, record} = loadPublication(options);
    // No output or intent writes until every source, target and rendered byte has passed preflight.
    const initial = preparePublication(context, record);
    const issueLock = assertPersistentAgentPath("task-plan", path.join(path.dirname(path.dirname(context.recordPath)), `.publication-issue-${record.issue.number}.lock`), context.root);
    let descriptor;
    try { descriptor = fs.openSync(issueLock, "wx"); }
    catch (error) {
        if (error.code === "EEXIST") { fail("PUBLICATION_LOCKED", "Another publication for this issue is running; finish/reconcile it before retrying."); }
        throw error;
    }
    try {
        let changed = initial.changed;
        const result = updatePublication(context, (current, {checkpoint}) => {
            const prepared = preparePublication(context, current);
            changed = prepared.changed;
            if (!changed.length && !current.intent) { return current; }
            assertFresh(context, current);
            const intent = current.intent ?? prepared.transaction;
            if (!current.intent) { checkpoint({...current, intent}); }
            const writeAtomic = options.writeAtomic ?? writeFileAtomic;
            // Materials become available before the plan that links them; never remove deselected files.
            const ordered = Object.keys(prepared.outputs).filter((name) => name !== "plan.md").sort().concat("plan.md");
            for (const name of ordered) {
                assertFresh(context, current);
                validateOutputHashes(context, {...current, intent}, prepared.desired);
                const filename = outputPath(context, current.issue, name);
                if (actualHash(filename) !== prepared.desired[name]) {
                    writeAtomic(filename, prepared.outputs[name], {rootDir: context.root});
                }
            }
            assertFresh(context, current);
            validateOutputHashes(context, {...current, intent}, prepared.desired);
            return {...current, outputs: intent.after, intent: null};
        }, {...options, expectedBase: options.expectedBase ?? readRecord(context).base});
        return {ok: true, changed, unchanged: changed.length === 0, path: `docs/plans/issue-${record.issue.number}/plan.md`, base: result.base};
    } finally {
        fs.closeSync(descriptor);
        fs.unlinkSync(issueLock);
    }
}

/** Read the existing execution pointer without updating it, scanning plans or inferring an issue. */
export function selectCommitPublication({repoRoot = process.cwd(), planPath} = {}) {
    const root = path.resolve(repoRoot);
    let selected = planPath;
    if (selected === undefined) {
        const pointer = assertPersistentAgentPath("plan-execute", path.join(resolvePersistentAgentRoot("plan-execute", root), "last-plan.txt"), root);
        let content;
        try { content = fs.readFileSync(pointer, "utf8"); }
        catch (error) {
            if (error.code === "ENOENT") { return {action: "skip", reason: "no-plan-selected"}; }
            throw error;
        }
        const lines = content.trim().split(/\r?\n/);
        if (lines.length !== 1 || !/^docs\/plans\/[^\r\n]+\.md$/.test(lines[0]) || lines[0].includes("\\") || lines[0].split("/").includes("..")) {
            fail("INVALID_PLAN_POINTER", "Repair the existing plan-execute pointer or explicitly select one canonical plan for this commit.");
        }
        [selected] = lines;
    }
    const {context, record} = loadPublication({repoRoot: root, planPath: selected});
    if (!record) {
        if (planPath !== undefined) { fail("PUBLICATION_NOT_BOUND", "Explicitly selected plan has no binding. Run bind as its owner or omit the publication selection."); }
        return {action: "skip", reason: "selected-plan-not-bound"};
    }
    return {action: "publish", planPath: context.identity.plan_path, issue: record.issue};
}

export function refreshCommitPublication(options = {}) {
    const selected = selectCommitPublication(options);
    if (selected.action === "skip") { return selected; }
    return {...selected, ...publishPlan({...options, planPath: selected.planPath})};
}

const usage = `Usage:
  publish.mjs bind --path <canonical-plan> --issue <full-GitHub-issue-URL> [--root <repo>]
  publish.mjs assess --path <canonical-plan> --input <file|-> [--root <repo>]
  publish.mjs check --path <canonical-plan> [--root <repo>]
  publish.mjs publish --path <canonical-plan> [--root <repo>]
  publish.mjs refresh-for-commit [--path <canonical-plan>] [--root <repo>]

Assessment JSON requires confirm_current_inputs: true and explicit arrays sources, summaries,
replacements, materials (use [] for none). Sources include path, disposition, status, reason.
Findings include text, status, source_paths and optional wp_id. Replacements add reference.
Materials add name, source_path, kind: report, duplicate/available_in_project/technical: false,
and justification: {essential, unique, summary_insufficient} with non-empty reasons.
Statuses: current, historical, requires-reassessment. assess confirms actual current hashes;
it never invokes an LLM, changes the canonical plan/pointer or adopts edited output hashes.`;

async function main(argv) {
    if (argv.includes("--help") || argv.includes("-h")) { process.stdout.write(`${usage}\n`); return; }
    const [command, ...rest] = argv;
    const args = {};
    for (let index = 0; index < rest.length; index += 2) {
        if (!["--path", "--issue", "--input", "--root"].includes(rest[index]) || !rest[index + 1] || args[rest[index]]) {
            fail("INVALID_ARGUMENT", usage);
        }
        args[rest[index]] = rest[index + 1];
    }
    const options = {planPath: args["--path"], repoRoot: args["--root"] ?? process.cwd()};
    let result;
    if (command === "bind" && args["--issue"]) { result = bindPublication({...options, issueUrl: args["--issue"]}); }
    else if (command === "assess" && args["--input"]) {
        const input = JSON.parse(fs.readFileSync(args["--input"] === "-" ? 0 : path.resolve(args["--input"]), "utf8"));
        result = assessPublication({...options, input});
    } else if (command === "check") {
        result = checkPublication(options);
    } else if (command === "publish") {
        result = publishPlan(options);
    } else if (command === "refresh-for-commit") {
        result = refreshCommitPublication(options);
    } else { fail("INVALID_ARGUMENT", usage); }
    process.stdout.write(json(result));
}

export function runCli(argv = process.argv.slice(2)) {
    return main(argv).catch((error) => {
        process.stderr.write(`${JSON.stringify({error: error.code ?? "PUBLICATION_ERROR", message: error.message, details: error.details ?? {}})}\n`);
        process.exitCode = error.code === "INVALID_ARGUMENT" ? 2 : 1;
    });
}

if (isMainModule(import.meta.url)) { runCli(); }
