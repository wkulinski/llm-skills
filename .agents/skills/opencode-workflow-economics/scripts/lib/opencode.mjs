import { firstText, integer, nested, record } from "./util.mjs";
export class OpenCodeDataError extends Error {
    code;
    constructor(code, message = code) {
        super(message);
        this.code = code;
        this.name = "OpenCodeDataError";
    }
}
async function unwrap(promise, code) {
    const response = await promise;
    if (response && typeof response === "object" && "error" in response && response.error) {
        throw new OpenCodeDataError(code, `${code}: ${String(response.error)}`);
    }
    if (response && typeof response === "object" && "data" in response) {
        const data = response.data;
        if (data === undefined)
        { throw new OpenCodeDataError(code); }
        return data;
    }
    return response;
}
function arrayPayload(value, code) {
    if (Array.isArray(value))
    { return value; }
    const object = record(value);
    for (const key of ["items", "results", "sessions", "messages", "children"]) {
        if (Array.isArray(object[key]))
        { return object[key]; }
    }
    throw new OpenCodeDataError(code);
}
export function sourceSession(value) {
    const item = record(value);
    const id = firstText(item.id, item.sessionID, item.sessionId);
    if (!id)
    { throw new OpenCodeDataError("invalid_session_payload"); }
    return {
        id,
        parent_id: firstText(item.parentID, item.parentId, item.parent_session_id),
        title: firstText(item.title),
        agent_name: firstText(item.agent, item.agentName),
        created_at_ms: integer(nested(item, "time", "created")) ?? integer(item.createdAt),
        updated_at_ms: integer(nested(item, "time", "updated")) ?? integer(item.updatedAt),
        version: firstText(item.version),
        status: firstText(item.status),
    };
}
export function sourceMessages(value) {
    return arrayPayload(value, "invalid_messages_payload").map((item) => {
        const entry = record(item);
        const info = record(entry.info ?? entry.message ?? entry);
        const partsRaw = entry.parts ?? [];
        if (!Array.isArray(partsRaw))
        { throw new OpenCodeDataError("invalid_parts_payload"); }
        return { info, parts: partsRaw.map(record) };
    }).sort((a, b) => {
        const at = Number(integer(nested(a.info, "time", "created")) ?? 0n);
        const bt = Number(integer(nested(b.info, "time", "created")) ?? 0n);
        if (at !== bt)
        { return at - bt; }
        return (firstText(a.info.id) ?? "").localeCompare(firstText(b.info.id) ?? "");
    });
}
function options(id, directory) {
    return { path: { id }, query: { directory } };
}
export class OpenCodeReader {
    client;
    directory;
    constructor(client, directory) {
        this.client = client;
        this.directory = directory;
    }
    async listSessions() {
        const payload = await unwrap(this.client.session.list({ query: { directory: this.directory } }), "session_list_failed");
        return arrayPayload(payload, "invalid_session_list_payload").map(sourceSession);
    }
    async getSession(id) {
        return sourceSession(await unwrap(this.client.session.get(options(id, this.directory)), "session_get_failed"));
    }
    async getChildren(id) {
        const payload = await unwrap(this.client.session.children(options(id, this.directory)), "session_children_failed");
        return arrayPayload(payload, "invalid_children_payload").map(sourceSession);
    }
    async getMessages(id) {
        const payload = await unwrap(this.client.session.messages(options(id, this.directory)), "session_messages_failed");
        return sourceMessages(payload);
    }
    async resolveRootSession(id) {
        let current = await this.getSession(id);
        const visited = new Set();
        while (current.parent_id) {
            if (visited.has(current.id))
            { throw new OpenCodeDataError("session_cycle"); }
            visited.add(current.id);
            current = await this.getSession(current.parent_id);
        }
        return current;
    }
    async fetchTree(root) {
        const result = [];
        const queue = [root];
        const visited = new Set();
        while (queue.length > 0) {
            const current = queue.shift();
            if (!current)
            { break; }
            if (visited.has(current.id))
            { throw new OpenCodeDataError("session_cycle"); }
            visited.add(current.id);
            const [messages, children] = await Promise.all([
                this.getMessages(current.id),
                this.getChildren(current.id),
            ]);
            result.push({ session: current, messages });
            for (const child of children) {
                if (child.parent_id !== current.id)
                { throw new OpenCodeDataError("cross_root_tree"); }
                queue.push(child);
            }
        }
        return result;
    }
}
export async function mapConcurrent(values, concurrency, work) {
    const results = new Array(values.length);
    let cursor = 0;
    async function worker() {
        while (true) {
            const index = cursor++;
            if (index >= values.length)
            { return; }
            results[index] = await work(values[index], index);
        }
    }
    await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, () => worker()));
    return results;
}
