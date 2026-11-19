import {createHash} from "node:crypto";

function requireValue(condition, message, code = "INVALID_VERIFICATION") {
    if (!condition) { throw Object.assign(new Error(message), {code}); }
}
function text(value) { requireValue(typeof value === "string" && value.trim().length > 0, "Verification needs a concrete explanation"); }
function sha(value) { requireValue(typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value), "Exact Git SHA required"); }
function safePath(value) {
    requireValue(typeof value === "string" && value.length > 0 && !value.includes("\\") && !/^(?:\/|[a-z]:)/i.test(value) && !value.split("/").some((p) => ["", ".", "..", ".git"].includes(p)), "Unsafe evidence path");
}
function proof(value, sourceIds) {
    requireValue(value && ["git_file", "git_diff", "worktree_file", "source"].includes(value.kind), "Unknown proof kind");
    requireValue(typeof value.hash === "string" && /^[a-f0-9]{64}$/.test(value.hash), "Evidence requires SHA-256");
    if (value.kind === "source") { requireValue(sourceIds.has(value.sourceId), "Unknown evidence source"); return; }
    if (value.kind === "git_diff") {
        sha(value.fromSha); sha(value.toSha);
        requireValue(Array.isArray(value.paths) && value.paths.length > 0, "Diff must declare exact paths");
        value.paths.forEach(safePath);
    } else { safePath(value.path); if (value.kind === "git_file") { sha(value.sha); } }
}
function stage(value, statuses, sourceIds) {
    requireValue(value && statuses.includes(value.status), "Missing verification stage or invalid stage status");
    text(value.rationale);
    requireValue(Array.isArray(value.evidence), "Stage requires an explicit evidence list");
    value.evidence.forEach((p) => proof(p, sourceIds));
    if (value.status === "verified") { requireValue(value.evidence.length > 0, "Verified stage has no proof"); }
}
export function validateInspection(value, sourceIds) {
    stage(value, ["verified", "unavailable"], sourceIds);
    if (value.status === "verified") {
        sha(value.sha);
        requireValue(value.evidence.some((p) => p.kind === "git_file" && p.sha === value.sha), "Source inspection requires a file from the inspected snapshot");
    }
}
export function validateVerification(assessment, sourceIds, projectSha) {
    const v = assessment.verification;
    requireValue(v, `Missing original/correction/current verification for ${assessment.id}`);
    validateInspection(v.original, sourceIds);
    const originalRef = assessment.sources.find((s) => s.id === v.original.sourceId);
    requireValue(originalRef && (sourceIds.has(v.original.sourceId) || (originalRef.unavailable === true && v.original.status === "unavailable")), "Original finding must identify its own source");
    if (assessment.sources.some((s) => s.unavailable === true)) { requireValue(assessment.historical === "unresolved", "Unavailable source must remain unresolved"); }
    stage(v.correction, ["verified", "not_required", "unavailable"], sourceIds);
    stage(v.current, ["verified", "unavailable"], sourceIds);
    if (v.current.status === "verified") {
        requireValue(v.current.sha === projectSha, "Current evidence must identify the evaluated project SHA");
        requireValue(v.current.evidence.some((p) => p.kind === "worktree_file" || (p.kind === "git_file" && p.sha === projectSha)), "Current stage needs current code or documentation");
    }
    const response = v.response;
    requireValue(response && ["none", "original", "post_fix", "later_decision", "unknown"].includes(response.relation) && Array.isArray(response.sourceIds), "Response needs an explicit relation to the evaluated state");
    requireValue(new Set(response.sourceIds).size === response.sourceIds.length && response.sourceIds.every((id) => sourceIds.has(id)), "Unknown or repeated response reference");
    requireValue(response.relation === "none" ? response.sourceIds.length === 0 : response.sourceIds.length > 0, "Response classification differs from its references");
    if (response.appliesToSha !== null) { sha(response.appliesToSha); }
    if (response.relation === "original") { requireValue(response.appliesToSha === v.original.sha, "Response to original state points to another SHA"); }
    if (v.correction.status === "verified") {
        sha(v.correction.fromSha); sha(v.correction.toSha);
        requireValue(v.correction.fromSha === v.original.sha && v.correction.fromSha !== v.correction.toSha, "Correction must compare the original state with a later state");
        requireValue(v.correction.evidence.some((p) => p.kind === "git_diff" && p.fromSha === v.correction.fromSha && p.toSha === v.correction.toSha), "Correction needs the exact before/after diff");
        requireValue(v.correction.evidence.some((p) => p.kind === "git_file" && p.sha === v.correction.toSha), "Correction needs a file in its resulting state");
        if (response.relation === "post_fix") { requireValue(response.appliesToSha === v.correction.toSha, "Post-fix response must identify the corrected version"); }
    }
    if (["fixed", "rejected", "accepted"].includes(assessment.historical)) { requireValue(v.original.status === "verified", "A later reply cannot resolve an unverified original finding"); }
    if (assessment.historical === "fixed") { requireValue(v.correction.status === "verified", "Fixed finding requires verified correction"); }
    if (assessment.historical === "accepted") {
        requireValue(v.decision && Array.isArray(v.decision.sourceIds) && v.decision.sourceIds.length > 0 && v.decision.sourceIds.every((id) => sourceIds.has(id)), "Accepted risk requires an explicit decision source");
        text(v.decision.scope);
    }
    if (v.original.status === "unavailable" || v.correction.status === "unavailable") { requireValue(assessment.historical === "unresolved", "Missing historical proof must remain unresolved"); }
    if (v.current.status === "unavailable") { requireValue(assessment.currency === "no_evidence", "Missing current proof must remain visible"); }
}
export function validateHistoryCoverage(entry, input, sources) {
    const ids = new Set(sources.sources.filter((s) => s.prId === entry.prId).map((s) => s.id));
    for (const old of input.previous?.assessments ?? []) {
        const retained = entry.assessments.find((a) => a.id === old.id);
        requireValue(retained, `Previously identified finding ${old.id} was omitted`, "INCOMPLETE_FINDING_COVERAGE");
        requireValue((old.sources ?? []).every((r) => retained.sources.some((ref) => ref.id === r.id)), `Previously identified finding ${old.id} lost its source`, "INCOMPLETE_FINDING_COVERAGE");
    }
    for (const a of entry.assessments) {
        for (const ref of a.sources) {
            if (ref.unavailable !== true) { continue; }
            const old = input.previous?.assessments.find((item) => item.id === a.id);
            requireValue(!ids.has(ref.id) && old?.sources.some((r) => r.id === ref.id && r.start === ref.start && r.end === ref.end), "Unavailable source must retain a previous finding range", "UNKNOWN_REFERENCE");
        }
        const original = a.verification.original;
        const source = sources.sources.find((s) => s.id === original.sourceId);
        const reviewedSha = source?.kind === "review_comment" ? source.originalCommitSha ?? source.commitSha : source?.kind === "review" ? source.commitSha : null;
        if (original.status === "verified" && reviewedSha) { requireValue(original.sha === reviewedSha, "Original evidence substitutes a later version for the reviewed SHA"); }
    }
    for (const d of entry.dispositions) {
        const source = sources.sources.find((s) => s.id === d.sourceId);
        const metadata = source.kind === "thread" || source.id === source.prId || !source.body.trim();
        if (d.status === "no_learning" && !metadata) {
            validateInspection(d.inspection, ids);
            if (d.inspection.status === "unavailable") { requireValue(entry.analysis !== "complete", "Uninspected discussion cannot be completed"); }
        }
    }
}
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function verifyEvidenceBytes(entry, sources, {git, readWorktree}) {
    const memo = new Map();
    const verify = (p) => {
        const key = JSON.stringify(p);
        if (memo.has(key)) { return; }
        let actual;
        try {
            if (p.kind === "git_file") { actual = digest(git(["show", `${p.sha}:${p.path}`])); }
            else if (p.kind === "git_diff") {
                const bytes = git(["diff", "--no-ext-diff", "--no-textconv", "--binary", p.fromSha, p.toSha, "--", ...p.paths]);
                requireValue(bytes.length > 0, "Declared correction diff is empty");
                actual = digest(bytes);
            }
            else if (p.kind === "worktree_file") { actual = readWorktree(p.path); }
            else { actual = digest(sources.sources.find((s) => s.id === p.sourceId).body); }
        } catch (error) { throw Object.assign(new Error(`Cannot read verification evidence: ${error.message}`), {code: "EVIDENCE_UNAVAILABLE"}); }
        requireValue(actual === p.hash, "Verification evidence bytes differ from the declared proof", "EVIDENCE_CONFLICT");
        memo.set(key, true);
    };
    for (const a of entry.assessments) {
        for (const name of ["original", "correction", "current"]) { a.verification[name].evidence.forEach(verify); }
    }
    for (const d of entry.dispositions) { d.inspection?.evidence.forEach(verify); }
}
