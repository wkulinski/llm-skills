import {DEFAULT_CONFIG} from "../scripts/lib/config.mjs";
import {analyzeRoots} from "../scripts/lib/analysis.mjs";
import {parseTree} from "../scripts/lib/parser.mjs";

export const CORPUS_VERSION = "owe-methodology-corpus-v3";

export const PRICING = {
    version: 1,
    currency: "USD",
    models: {
        "provider/model": {
            aliases: [],
            reasoning_accounting: "included_in_output",
            cache_read_accounting: "excluded",
            cache_write_accounting: "excluded",
            prices_per_million: {
                input: "1",
                output: "2",
                cache_read: "0",
                cache_write: "0",
            },
        },
    },
};

const KNOWN_MODEL = {provider_id: "provider", model_id: "model"};

export const CORPUS_CASES = [
    {
        id: "patterns",
        description: "Coherent recurring discovery, mixed structural work, micro-operations, and broad reconnaissance.",
        roots: [
            root("pattern-coherent-1", "Find the configuration entry point.", [
                step({tools: [search("src", "configuration"), read("src/config/app.mjs"), read("src/config/env.mjs")] }),
            ]),
            root("pattern-coherent-2", "Find the configuration entry point.", [
                step({tools: [search("src", "configuration"), read("src/config/app.mjs"), read("src/config/env.mjs")] }),
            ]),
            root("pattern-mixed-1", "Implement the migration and verify the changed file.", [
                step({tools: [search("migrations", "table"), read("migrations/001.sql"), write("migrations/001.sql")] }),
            ]),
            root("pattern-mixed-2", "Review the unrelated migration for a release note.", [
                step({tools: [search("docs", "migration"), read("docs/release.md"), write("docs/release.md")] }),
            ]),
            root("pattern-micro-1", "Read one small file.", [
                step({tools: [read("src/one.mjs"), read("src/two.mjs")] }),
            ]),
            root("pattern-micro-2", "Read another small pair of files.", [
                step({tools: [read("src/three.mjs"), read("src/four.mjs")] }),
            ]),
            root("pattern-broad", "Reconnaissance across repository and tests.", [
                step({tools: [search(".", "controller")]}),
                step({tools: [read("src/Controller.mjs")]}),
                step({tools: [shell("rg --files tests")]}),
                step({tools: [read("tests/Controller.test.mjs")]}),
            ]),
        ],
        expectations: {
            coherent_pattern: {operations: ["repository.search", "file.read{2-3}"], occurrences: 2, distinct_root_sessions: 2, semantic_coherent: true, delegable: true},
            mixed_pattern: {operations: ["repository.search", "file.read", "file.write"], occurrences: 2, distinct_root_sessions: 2, semantic_coherent: false, delegable: false},
            micro_pattern: {operations: ["file.read{2-3}"], occurrences: 2, distinct_root_sessions: 2, semantic_coherent: true, delegable: true},
            broad_reconnaissance: {semantic_coherent: false, delegable: false},
        },
    },
    {
        id: "overlap",
        description: "Ordered, post-write, command, structural-only, unordered, and overlapping timing evidence.",
        roots: [
            delegationRoot("overlap-strong", "child-strong", {
                childTools: [search("src/Order.mjs", "Order")],
                parentFollowup: [search("src/Order.mjs", "Order")],
            }),
            delegationRoot("overlap-post-write", "child-post-write", {
                childTools: [read("src/Order.mjs")],
                parentFollowup: [write("src/Order.mjs"), read("src/Order.mjs")],
            }),
            delegationRoot("overlap-post-write-not-strong", "child-post-write-not-strong", {
                childTools: [shell("node scripts/check.mjs"), search("src/PostWrite.mjs", "first"), search("src/PostWrite.mjs", "second")],
                parentFollowup: [shell("node scripts/check.mjs"), write("src/PostWrite.mjs"), search("src/PostWrite.mjs", "first"), search("src/PostWrite.mjs", "second")],
            }),
            delegationRoot("overlap-command", "child-command", {
                childTools: [shell("node scripts/check.mjs")],
                parentFollowup: [shell("node scripts/check.mjs")],
            }),
            delegationRoot("overlap-verification", "child-verification", {
                childTools: [shell("npm test")],
                parentFollowup: [shell("npm test")],
            }),
            delegationRoot("overlap-structural", "child-structural", {
                childTools: [search("src/A.mjs", "alpha")],
                parentFollowup: [search("src/B.mjs", "beta")],
            }),
            delegationRoot("overlap-multi-structural", "child-multi-structural", {
                childTools: [search("src/MultiChild.mjs", "alpha"), read("src/MultiChild.mjs")],
                parentFollowup: [search("src/MultiParent.mjs", "beta"), read("src/MultiParent.mjs")],
            }),
            delegationRoot("overlap-unknown-time", "child-unknown-time", {
                childTools: [read("src/Unknown.mjs")],
                parentFollowup: [read("src/Unknown.mjs")],
                parentFollowupStart: null,
            }),
            delegationRoot("overlap-overlapping-time", "child-overlapping-time", {
                childTools: [read("src/Overlap.mjs")],
                parentFollowup: [read("src/Overlap.mjs")],
                parentFollowupTiming: [{start: 25, end: 35}],
            }),
            delegationRoot("overlap-subtree-time", "child-subtree-time", {
                childTools: [read("src/Subtree.mjs")],
                parentFollowup: [read("src/Subtree.mjs")],
                parentFollowupTiming: [{start: 65, end: 70}],
                grandchild: {id: "grandchild-subtree-time", start: 50, end: 60},
            }),
            delegationRoot("overlap-boundary-time", "child-boundary-time", {
                childTools: [search("src/Boundary.mjs", "Boundary")],
                parentFollowup: [search("src/Boundary.mjs", "Boundary")],
                parentFollowupTiming: [{start: 30, end: 40}],
            }),
            delegationRoot("overlap-missing-child-time", "child-missing-child-time", {
                childTools: [read("src/MissingChild.mjs")],
                parentFollowup: [read("src/MissingChild.mjs")],
                childComplete: false,
            }),
            delegationRoot("overlap-missing-parent-end", "child-missing-parent-end", {
                childTools: [read("src/MissingEnd.mjs")],
                parentFollowup: [read("src/MissingEnd.mjs")],
                parentFollowupTiming: [{start: 25, end: null}],
            }),
            delegationRoot("overlap-window-limit", "child-window-limit", {
                childTools: [read("src/Limit.mjs")],
                parentFollowup: [read("src/Limit.mjs"), read("src/AfterLimit.mjs")],
            }),
        ],
        expectations: {
            diagnostics: {
                "overlap-strong:tool:0": {diagnostic: "strong_repeated_work_signal", ordered: true, pre_write_matches: 2},
                "overlap-post-write:tool:0": {diagnostic: "mixed_followup", ordered: true, pre_write_matches: 0},
                "overlap-post-write-not-strong:tool:0": {diagnostic: "mixed_followup", ordered: true, pre_write_matches: 1, post_write_matches: 3, command_pre_write_matches: 1},
                "overlap-command:tool:0": {diagnostic: "possible_repeated_work", ordered: true, pre_write_matches: 1, same_command_count: 1},
                "overlap-verification:tool:0": {diagnostic: "possible_repeated_work", ordered: true, pre_write_matches: 1, same_command_count: 1, deliberate_verification: true},
                "overlap-structural:tool:0": {diagnostic: "no_overlap_observed_in_window", ordered: true, pre_write_matches: 0},
                "overlap-multi-structural:tool:0": {diagnostic: "no_overlap_observed_in_window", ordered: true, pre_write_matches: 0},
                "overlap-unknown-time:tool:0": {diagnostic: "insufficient_evidence", ordered: false, pre_write_matches: 0, unordered_matches: 1, unknown_timing_steps: 1, limitation: "timestamps"},
                "overlap-overlapping-time:tool:0": {diagnostic: "insufficient_evidence", ordered: false, pre_write_matches: 0, overlapping_matches: 1},
                "overlap-subtree-time:tool:0": {diagnostic: "possible_repeated_work", ordered: true, pre_write_matches: 1, child_completion: 60},
                "overlap-boundary-time:tool:0": {diagnostic: "strong_repeated_work_signal", ordered: true, pre_write_matches: 2, child_completion: 30},
                "overlap-missing-child-time:tool:0": {diagnostic: "insufficient_evidence", ordered: false, pre_write_matches: 0, unordered_matches: 1, limitation: "could not be confirmed"},
                "overlap-missing-parent-end:tool:0": {diagnostic: "insufficient_evidence", ordered: false, pre_write_matches: 0, unordered_matches: 1},
                "overlap-window-limit:tool:0": {diagnostic: "possible_repeated_work", ordered: true, pre_write_matches: 1},
            },
        },
    },
    {
        id: "pricing",
        description: "Complete, incomplete-with-usage, incomplete-without-usage, and missing-pricing coverage.",
        roots: [
            root("pricing-complete", "Complete priced step.", [step({tokens: {input: 100, output: 50}})]),
            root("pricing-incomplete-priced", "Incomplete step with observed usage.", [step({tokens: {input: 100, output: 50}, complete: false})]),
            root("pricing-incomplete-missing-usage", "Incomplete step without usage.", [step({complete: false})]),
            root("pricing-missing-model", "Complete step with unknown model.", [step({model_id: "unknown-model", tokens: {input: 100, output: 50}})]),
        ],
        expectations: {
            statuses: {
                "pricing-complete": {step_status: "complete", cost_status: "complete", pricing_status: "complete"},
                "pricing-incomplete-priced": {step_status: "incomplete", cost_status: "complete", pricing_status: "incomplete"},
                "pricing-incomplete-missing-usage": {step_status: "incomplete", cost_status: "missing_usage", pricing_status: "incomplete"},
                "pricing-missing-model": {step_status: "complete", cost_status: "missing_pricing", pricing_status: "missing_pricing"},
            },
        },
    },
];

export function analyzeCorpusCase(caseDefinition) {
    const config = mergeConfig(caseDefinition.config);
    const parsedRoots = caseDefinition.roots.map((entry) => parseTree(
        entry.tree,
        entry.root_session_id,
        config,
        caseDefinition.pricing ?? PRICING,
        "compact",
    ));
    return analyzeRoots(parsedRoots, config, caseDefinition.pricing ?? PRICING, {
        corpus_case: caseDefinition.id,
        corpus_version: CORPUS_VERSION,
    });
}

export function analyzeCorpus() {
    const config = mergeConfig();
    const pricing = PRICING;
    const parsedRoots = CORPUS_CASES.flatMap((caseDefinition) => caseDefinition.roots.map((entry) => parseTree(
        entry.tree,
        entry.root_session_id,
        config,
        caseDefinition.pricing ?? pricing,
        "compact",
    )));
    return analyzeRoots(parsedRoots, config, pricing, {
        corpus_version: CORPUS_VERSION,
        corpus_cases: CORPUS_CASES.map((item) => item.id),
    });
}

function mergeConfig(overrides = {}) {
    const config = structuredClone(DEFAULT_CONFIG);
    for (const [key, value] of Object.entries(overrides)) {
        if (value && typeof value === "object" && !Array.isArray(value)) { config[key] = {...config[key], ...value}; }
        else { config[key] = value; }
    }
    return config;
}

function root(id, request, steps, options = {}) {
    return {
        root_session_id: id,
        tree: [rawSession({id, request, steps, ...options})],
    };
}

function delegationRoot(id, childId, options) {
    const parentSteps = [
        step({
            start: 1,
            end: 2,
            tools: [task(childId)],
        }),
        ...options.parentFollowup.map((tool, index) => step({
            start: options.parentFollowupTiming?.[index]?.start
                ?? (options.parentFollowupStart === null ? null : 40 + index * 10),
            end: options.parentFollowupTiming?.[index]?.end !== undefined
                ? options.parentFollowupTiming[index].end
                : 50 + index * 10,
            tools: [tool],
        })),
    ];
    return {
        root_session_id: id,
        tree: [
            rawSession({id, request: `Delegation case ${id}.`, steps: parentSteps, updated: 100}),
            rawSession({id: childId, parent_id: id, request: `Child work for ${id}.`, steps: [step({start: 20, end: 30, tools: options.childTools, complete: options.childComplete ?? true})], agent_name: "context-scout-fast", updated: 35}),
            ...(options.grandchild ? [rawSession({id: options.grandchild.id, parent_id: childId, request: `Nested child work for ${id}.`, steps: [step({start: options.grandchild.start, end: options.grandchild.end})], agent_name: "context-scout-fast", updated: options.grandchild.end})] : []),
        ],
    };
}

function rawSession({id, parent_id = null, request, steps, agent_name = "main", provider_id = KNOWN_MODEL.provider_id, model_id = KNOWN_MODEL.model_id, updated = 100}) {
    const messages = [];
    if (request) { messages.push({info: {role: "user", id: `${id}-request`, time: {created: 1}}, parts: [{type: "text", text: request}]}); }
    for (const [index, definition] of steps.entries()) { messages.push(rawStep({
        id,
        index,
        agent_name,
        provider_id,
        model_id,
        ...definition,
    })); }
    return {
        session: {id, parent_id, title: id, created_at_ms: 1, updated_at_ms: updated, agent_name},
        messages,
    };
}

function rawStep({id, index, agent_name, provider_id, model_id, tools = [], tokens = {}, start = 1 + index * 10, end = 2 + index * 10, complete = true}) {
    const parts = [{type: "step-start", time: start === null ? undefined : {start}}];
    for (const [toolIndex, toolPart] of tools.entries()) { parts.push({...toolPart, id: `${id}-tool-${index}-${toolIndex}`}); }
    if (complete) { parts.push({type: "step-finish", reason: "stop", time: end === null ? undefined : {end}, tokens: tokenPayload(tokens)}); }
    else if (Object.keys(tokens).length > 0) { parts.push({type: "text", text: "partial output", tokens: tokenPayload(tokens)}); }
    return {
        info: {
            role: "assistant",
            id: `${id}-message-${index}`,
            agent: agent_name,
            providerID: provider_id,
            modelID: model_id,
            time: start === null && end === null ? undefined : {created: start, completed: end},
        },
        parts: parts.map((part) => Object.fromEntries(Object.entries(part).filter(([, value]) => value !== undefined))),
    };
}

function tokenPayload(tokens) {
    return {
        input: tokens.input ?? 0,
        output: tokens.output ?? 0,
        reasoning: tokens.reasoning ?? 0,
        cache: {read: tokens.cache_read ?? 0, write: tokens.cache_write ?? 0},
    };
}

function tool(name, input, options = {}) {
    return {
        type: "tool",
        tool: name,
        state: {
            status: options.status ?? "completed",
            input,
            output: options.status === "error" ? undefined : options.output ?? "ok",
            error: options.status === "error" ? options.output ?? "error" : undefined,
            time: {start: options.start ?? 1, end: options.end ?? 2},
            metadata: options.metadata,
        },
    };
}

function search(path, pattern) {
    return tool("search", {path, pattern});
}

function read(filePath) {
    return tool("read", {filePath});
}

function write(filePath) {
    return tool("write", {filePath});
}

function shell(command) {
    return tool("shell", {command});
}

function task(childId) {
    return tool("task", {subagent_type: "context-scout-fast", prompt: `Inspect evidence for ${childId}.`}, {
        metadata: {sessionId: childId, background: false},
    });
}

function step(options = {}) {
    return options;
}
