import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {canonicalJson, sourceFingerprint, fingerprint} from "./contracts.mjs";
import {createLearningStore} from "./learning-store.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function proofsOf(entry) {
    const values = [];
    for (const assessment of entry.assessments) {
        values.push(...(assessment.evidence ?? []));
        for (const stage of ["original", "correction", "current"]) { values.push(...(assessment.verification?.[stage]?.evidence ?? [])); }
    }
    for (const disposition of entry.dispositions ?? []) { values.push(...(disposition.inspection?.evidence ?? [])); }
    return [...new Map(values.map((proof) => [canonicalJson(proof), proof])).values()];
}

/** Retain exact versions. Failure to recover legacy evidence is a recorded gap, never substitution. */
function readWorktreeEvidence(root, evidencePath) {
    const parts = evidencePath.split("/");
    if (parts.some((part) => ["", ".", "..", ".git"].includes(part)) || path.isAbsolute(evidencePath) || evidencePath.includes("\\")) { throw new Error("Unsafe evidence path"); }
    for (let i = 1; i <= parts.length; i++) { if (fs.lstatSync(path.join(root, ...parts.slice(0, i))).isSymbolicLink()) { throw new Error("Symlink evidence path"); } }
    return fs.readFileSync(path.join(root, evidencePath));
}

export function archiveAnalysis({entry, sources = null, context = null, root, git, legacy = false, analyzedAt = null, pr = null, recoveredBytes = new Map()}) {
    const store = createLearningStore({cwd: root});
    const gaps = [];
    const candidates = sources?.sources.filter((source) => source.prId === entry.prId) ?? [];
    const matching = sources && sourceFingerprint(candidates) === entry.sourceFingerprint;
    if (!matching) { gaps.push({kind: "sources", reason: "exact_historical_source_version_unavailable", expected: entry.sourceFingerprint}); }
    const proofRecords = proofsOf(entry).map((proof) => {
        let bytes;
        try {
            if (recoveredBytes.has(proof.hash)) { bytes = recoveredBytes.get(proof.hash); }
            else if (proof.kind === "source") {
                const source = matching && candidates.find((candidate) => candidate.id === proof.sourceId);
                if (!source) { throw new Error("Exact source version unavailable"); } bytes = Buffer.from(source.body);
            } else if (proof.kind === "git_file") { bytes = git(["show", `${proof.sha}:${proof.path}`]); }
            else if (proof.kind === "git_diff") { bytes = git(["diff", "--no-ext-diff", "--no-textconv", "--binary", proof.fromSha, proof.toSha, "--", ...proof.paths]); }
            else if (proof.kind === "worktree_file") {
                bytes = readWorktreeEvidence(root, proof.path);
            } else { throw new Error("Legacy evidence has no retrievable byte contract"); }
            if (digest(bytes) !== proof.hash) { throw new Error("Recovered bytes differ from historical proof hash"); }
            return {proof, artifact: store.putBytes("evidence-bytes", bytes)};
        } catch (error) {
            if (!legacy) { throw Object.assign(new Error(`Cannot persist learning evidence: ${error.message}`), {code: "EVIDENCE_UNAVAILABLE"}); }
            const gap = {kind: "evidence", proof, reason: error.message}; gaps.push(gap);
            return {proof, unavailable: true, reason: error.message};
        }
    });
    let archivedContext = context;
    if (context?.fingerprint !== entry.contextFingerprint || fingerprint(context.files) !== context.fingerprint) {
        gaps.push({kind: "context", reason: "exact_historical_context_unavailable", expected: entry.contextFingerprint});
        archivedContext = null;
    }
    return {kind: "learning-history", pr: pr ?? sources?.prs.find((item) => item.id === entry.prId) ?? null,
        analyzedAt, sourceRead: matching ? sources.read : null, sources: matching ? candidates : [], context: archivedContext, proofs: proofRecords, gaps};
}
