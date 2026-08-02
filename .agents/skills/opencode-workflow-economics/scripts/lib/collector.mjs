import { analyzeRoots } from "./analysis.mjs";
import { mapConcurrent, OpenCodeReader } from "./opencode.mjs";
import { parseTree } from "./parser.mjs";
export async function collectBundle(client, config, pricing, options) {
    const reader = new OpenCodeReader(client, config.opencode.directory);
    const roots = await selectRoots(reader, options);
    const parsedRoots = await mapConcurrent(roots, config.collection.concurrency, async (root) => {
        const tree = await reader.fetchTree(root);
        return parseTree(tree, root.id, config, pricing, options.content_mode);
    });
    return analyzeRoots(parsedRoots, config, pricing, {
        base_url: config.opencode.base_url,
        directory: config.opencode.directory,
        since: options.since_label,
        requested_sessions: options.session_ids,
        content_mode: options.content_mode,
    });
}
async function selectRoots(reader, options) {
    if (options.session_ids.length > 0) {
        const resolved = await Promise.all(options.session_ids.map((id) => reader.resolveRootSession(id)));
        return dedupe(resolved);
    }
    const sessions = await reader.listSessions();
    return sessions
        .filter((session) => session.parent_id === null)
        .filter((session) => {
            if (options.since_ms === null)
            { return true; }
            const timestamp = session.updated_at_ms ?? session.created_at_ms;
            return timestamp !== null && timestamp >= BigInt(options.since_ms);
        })
        .sort((a, b) => Number((b.updated_at_ms ?? b.created_at_ms ?? 0n) - (a.updated_at_ms ?? a.created_at_ms ?? 0n)))
        .slice(0, options.limit);
}
function dedupe(sessions) {
    return [...new Map(sessions.map((session) => [session.id, session])).values()];
}
