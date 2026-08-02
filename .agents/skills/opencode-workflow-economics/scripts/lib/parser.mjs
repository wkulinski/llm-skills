import { calculateStepCost } from "./pricing.mjs";
import { bool, clampText, firstText, integer, nested, record, sha256, utf8Metrics } from "./util.mjs";
function partType(part) {
    return firstText(part.type) ?? "unknown";
}
function role(info) {
    return firstText(info.role);
}
function toolStatus(state) {
    return firstText(state.status) ?? "unknown";
}
function outputMetrics(state) {
    const status = toolStatus(state);
    if (status !== "completed" && status !== "error")
    { return { bytes: null, lines: null }; }
    const output = status === "completed" ? state.output : state.error;
    if (typeof output !== "string")
    { return { bytes: null, lines: null }; }
    return utf8Metrics(output);
}
function usageFromFinish(part) {
    return usageFromSources(part, part.usage);
}
function usageFromSources(...sources) {
    const records = sources.map(record);
    const tokenRecords = records.flatMap((source) => [record(source.tokens), record(source.usage)]);
    const cacheRecords = tokenRecords.map((tokens) => record(tokens.cache));
    return {
        input_tokens: firstInteger(...tokenRecords.map((tokens) => tokens.input), ...records.map((source) => source.input_tokens ?? source.inputTokens)),
        output_tokens: firstInteger(...tokenRecords.map((tokens) => tokens.output), ...records.map((source) => source.output_tokens ?? source.outputTokens)),
        reasoning_tokens: firstInteger(...tokenRecords.map((tokens) => tokens.reasoning), ...records.map((source) => source.reasoning_tokens ?? source.reasoningTokens)),
        cache_read_tokens: firstInteger(...cacheRecords.map((cache) => cache.read), ...tokenRecords.map((tokens) => tokens.cache_read), ...records.map((source) => source.cache_read_tokens ?? source.cacheReadTokens)),
        cache_write_tokens: firstInteger(...cacheRecords.map((cache) => cache.write), ...tokenRecords.map((tokens) => tokens.cache_write), ...records.map((source) => source.cache_write_tokens ?? source.cacheWriteTokens)),
    };
}
function firstInteger(...values) {
    for (const value of values) {
        const result = integer(value);
        if (result !== null)
        { return result; }
    }
    return null;
}
function assistantMetadata(info, fallback) {
    const model = record(info.model);
    return {
        agent_name: firstText(info.agent, info.mode, fallback.agent_name),
        provider_id: firstText(info.providerID, info.providerId, model.providerID, model.providerId, fallback.provider_id),
        model_id: firstText(info.modelID, info.modelId, model.modelID, model.modelId, fallback.model_id),
        variant: firstText(info.variant, fallback.variant),
    };
}
function classifyShellOperation(config, category, input) {
    if (category !== "shell")
    { return null; }
    const command = firstText(input.command, input.cmd);
    if (!command)
    { return "shell.other"; }
    for (const rule of config.shell_rules) {
        try {
            if (new RegExp(rule.pattern, "i").test(command))
            { return rule.category; }
        }
        catch {
            continue;
        }
    }
    return "shell.other";
}
function toolCategory(config, name) {
    return config.tool_mappings[name] ?? "other";
}
function textLimit(config, mode) {
    return mode === "full" ? config.collection.full_text_chars : config.collection.compact_text_chars;
}
function extractTextParts(parts) {
    return parts.flatMap((part) => {
        if (partType(part) !== "text")
        { return []; }
        const value = firstText(part.text, part.content);
        return value ? [value] : [];
    });
}

function normalizePath(value) {
    return value.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/{2,}/g, "/");
}
function normalizeQuery(value) {
    return value.trim().replace(/\s+/g, " ").toLowerCase();
}
function hashedResource(kind, value, normalizer = normalizeQuery) {
    const normalized = normalizer(value);
    return normalized ? sha256({ kind, value: normalized }) : null;
}
function resourceKeys(category, input) {
    const paths = [];
    const queries = [];
    const symbols = [];
    const commands = [];
    const add = (target, kind, value, normalizer) => {
        if (typeof value !== "string" || value.trim() === "")
        { return; }
        const key = hashedResource(kind, value, normalizer);
        if (key)
        { target.push(key); }
    };
    if (["read", "write"].includes(category)) {
        add(paths, "path", firstText(input.filePath, input.file_path, input.path, input.filename), normalizePath);
    }
    if (category === "search") {
        add(paths, "path", firstText(input.path, input.directory), normalizePath);
        add(queries, "query", firstText(input.pattern, input.query, input.glob), normalizeQuery);
        add(symbols, "symbol", firstText(input.symbol), normalizeQuery);
    }
    if (category === "shell") {
        add(commands, "command", firstText(input.command, input.cmd), normalizeQuery);
    }
    return {
        paths: [...new Set(paths)],
        queries: [...new Set(queries)],
        symbols: [...new Set(symbols)],
        commands: [...new Set(commands)],
    };
}

function semanticHint(config, mode, category, input) {
    if (mode === "metadata")
    { return null; }
    const limit = Math.min(textLimit(config, mode), mode === "full" ? 4000 : 500);
    if (category === "delegation" && config.privacy.include_task_prompt) {
        const prompt = firstText(input.prompt, input.description, input.task);
        return prompt ? `task: ${clampText(prompt, limit)}` : null;
    }
    if (["read", "write"].includes(category) && config.privacy.include_paths) {
        const path = firstText(input.filePath, input.file_path, input.path, input.filename);
        return path ? `${category}: ${clampText(path, limit)}` : null;
    }
    if (category === "search") {
        const query = config.privacy.include_search_queries
            ? firstText(input.pattern, input.query, input.symbol, input.glob)
            : null;
        const path = config.privacy.include_paths ? firstText(input.path, input.directory) : null;
        const values = [query && `query=${query}`, path && `path=${path}`].filter(Boolean);
        return values.length > 0 ? `${category}: ${clampText(values.join("; "), limit)}` : null;
    }
    if (category === "skill") {
        const name = firstText(input.name, input.skill);
        return name ? `skill: ${name}` : null;
    }
    return null;
}
export function parseTree(tree, rootSessionId, config, pricing, mode) {
    const parsed = tree.map((entry) => parseSession(entry, rootSessionId, config, pricing, mode));
    return validateTaskLinks(parsed);
}
function parseSession(entry, rootSessionId, config, pricing, mode) {
    let stepOrdinal = 0;
    let toolOrdinal = 0;
    let current = null;
    const steps = [];
    const tools = [];
    const userRequests = [];
    let assistantFinal = null;
    let userContext = {
        agent_name: entry.session.agent_name,
        provider_id: null,
        model_id: null,
        variant: null,
    };
    const closeIncomplete = () => {
        if (!current)
        { return; }
        current.status = "incomplete";
        const calculated = calculateStepCost(pricing, {
            provider_id: current.provider_id,
            model_id: current.reported_model_id,
            usage: current.usage,
        });
        current.pricing_model_id = calculated.pricing_model_id;
        current.cost_status = calculated.status;
        current.api_equivalent_cost_nano = calculated.value_nano;
        current.context_input_tokens = calculated.context_input_tokens;
        current.uncached_input_tokens = calculated.uncached_input_tokens;
        steps.push(current);
        current = null;
    };
    for (const message of entry.messages) {
        const messageRole = role(message.info);
        if (messageRole === "user") {
            userContext = assistantMetadata(message.info, userContext);
            if (config.privacy.include_user_text && mode !== "metadata") {
                const limit = textLimit(config, mode);
                for (const value of extractTextParts(message.parts))
                { userRequests.push(clampText(value, limit)); }
            }
            continue;
        }
        if (messageRole !== "assistant")
        { continue; }
        const metadata = assistantMetadata(message.info, userContext);
        if (current)
        { current.usage = mergeUsage(current.usage, usageFromSources(message.info)); }
        const messageId = firstText(message.info.id);
        const messageCreated = integer(nested(message.info, "time", "created"));
        const messageCompleted = integer(nested(message.info, "time", "completed"));
        const finalTexts = extractTextParts(message.parts);
        if (config.privacy.include_assistant_final_text && mode !== "metadata" && finalTexts.length > 0) {
            assistantFinal = clampText(finalTexts.at(-1), textLimit(config, mode));
        }
        for (const part of message.parts) {
            const type = partType(part);
            if (current)
            { current.usage = mergeUsage(current.usage, usageFromSources(part, record(part.state).metadata)); }
            if (type === "step-start") {
                closeIncomplete();
                current = {
                    id: `${entry.session.id}:step:${stepOrdinal}`,
                    session_id: entry.session.id,
                    root_session_id: rootSessionId,
                    ordinal: stepOrdinal,
                    message_id: messageId,
                    agent_name: metadata.agent_name,
                    provider_id: metadata.provider_id,
                    reported_model_id: metadata.model_id,
                    pricing_model_id: null,
                    model_variant: metadata.variant,
                    status: "incomplete",
                    finish_reason: null,
                    retry_count: 0,
                    compaction_count: 0,
                    started_at_ms: integer(nested(part, "time", "start")) ?? messageCreated,
                    completed_at_ms: null,
                    usage: emptyUsage(),
                    reported_cost_nano: null,
                    api_equivalent_cost_nano: null,
                    cost_status: "missing_usage",
                    context_input_tokens: null,
                    uncached_input_tokens: null,
                };
                stepOrdinal += 1;
                continue;
            }
            if (type === "tool") {
                const state = record(part.state);
                const input = record(state.input);
                const metrics = outputMetrics(state);
                const toolName = firstText(part.tool, part.name) ?? "unknown";
                const metadataState = record(state.metadata);
                const category = toolCategory(config, toolName);
                const task = category === "delegation";
                tools.push({
                    id: `${entry.session.id}:tool:${toolOrdinal}`,
                    session_id: entry.session.id,
                    root_session_id: rootSessionId,
                    step_id: current?.id ?? null,
                    step_ordinal: current?.ordinal ?? null,
                    ordinal: toolOrdinal,
                    part_id: firstText(part.id),
                    call_id: firstText(part.callID, part.callId),
                    tool_name: toolName,
                    tool_category: category,
                    operation_category: task
                        ? (metadataState.background === true ? "delegation.background" : "delegation.foreground")
                        : classifyShellOperation(config, category, input),
                    status: toolStatus(state),
                    started_at_ms: integer(nested(state, "time", "start")),
                    completed_at_ms: integer(nested(state, "time", "end")),
                    output_bytes: metrics.bytes,
                    output_lines: metrics.lines,
                    subagent_name: task ? firstText(input.subagent_type, input.subagentType) : null,
                    child_session_id: null,
                    task_link_status: task ? "unlinked" : null,
                    background: task ? bool(metadataState.background) : null,
                    semantic_hint: semanticHint(config, mode, category, input),
                    resource_keys: resourceKeys(category, input),
                    candidate_child_session_id: task ? firstText(metadataState.sessionId, metadataState.sessionID) : null,
                });
                toolOrdinal += 1;
                continue;
            }
            if (type === "retry") {
                if (current)
                { current.retry_count += 1; }
                continue;
            }
            if (type === "compaction") {
                if (current)
                { current.compaction_count += 1; }
                continue;
            }
            if (type === "step-finish") {
                if (!current)
                { continue; }
                current.usage = mergeUsage(current.usage, usageFromFinish(part));
                current.finish_reason = firstText(part.reason);
                current.status = "complete";
                current.completed_at_ms = integer(nested(part, "time", "end")) ?? messageCompleted;
                const reportedCost = part.cost;
                current.reported_cost_nano = decimalCostToNano(reportedCost);
                const calculated = calculateStepCost(pricing, {
                    provider_id: current.provider_id,
                    model_id: current.reported_model_id,
                    usage: current.usage,
                });
                current.pricing_model_id = calculated.pricing_model_id;
                current.cost_status = calculated.status;
                current.api_equivalent_cost_nano = calculated.value_nano;
                current.context_input_tokens = calculated.context_input_tokens;
                current.uncached_input_tokens = calculated.uncached_input_tokens;
                steps.push(current);
                current = null;
            }
        }
    }
    closeIncomplete();
    return {
        session: {
            ...entry.session,
            title: config.privacy.include_titles && mode !== "metadata" ? entry.session.title : null,
        },
        steps,
        tools,
        semantic: {
            user_requests: userRequests,
            assistant_final: assistantFinal,
        },
    };
}
function decimalCostToNano(value) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0)
    { return BigInt(Math.round(value * 1_000_000_000)); }
    if (typeof value === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
        const [whole = "0", fraction = ""] = value.split(".");
        return BigInt(whole) * 1000000000n + BigInt(fraction.slice(0, 9).padEnd(9, "0") || "0");
    }
    return null;
}
function emptyUsage() {
    return {
        input_tokens: null,
        output_tokens: null,
        reasoning_tokens: null,
        cache_read_tokens: null,
        cache_write_tokens: null,
    };
}
function mergeUsage(current, next) {
    return Object.fromEntries(Object.keys(current).map((key) => [key, next[key] ?? current[key]]));
}
function validateTaskLinks(parsed) {
    const sessions = new Map(parsed.map((item) => [item.session.id, item.session]));
    const usedChildren = new Set();
    return parsed.map((item) => ({
        ...item,
        tools: item.tools.map((temporary) => {
            const { candidate_child_session_id: candidate, ...tool } = temporary;
            if (tool.tool_category !== "delegation")
            { return tool; }
            if (!candidate)
            { return { ...tool, task_link_status: "unlinked", child_session_id: null }; }
            const child = sessions.get(candidate);
            if (!child)
            { return { ...tool, task_link_status: "unlinked", child_session_id: null }; }
            if (child.parent_id !== tool.session_id)
            { return { ...tool, task_link_status: "invalid_parent", child_session_id: null }; }
            if (usedChildren.has(candidate))
            { return { ...tool, task_link_status: "duplicate_child", child_session_id: null }; }
            usedChildren.add(candidate);
            return { ...tool, task_link_status: "valid", child_session_id: candidate };
        }),
    }));
}
