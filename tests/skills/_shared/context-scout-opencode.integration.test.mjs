import assert from "node:assert/strict";
import path from "node:path";
import {test} from "vitest";
import {spawnSync} from "../../helpers/bounded-spawn-sync.mjs";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../");
function debugAgent(name) {
    const result = spawnSync("opencode", ["debug", "agent", name], {cwd: ROOT, encoding: "utf8"});
    assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
}
function matches(value, pattern) { return new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`).test(value); }
function actionFor(agent, permission, resource = "*") {
    return agent.permission.findLast(rule => matches(permission, rule.permission) && matches(resource, rule.pattern))?.action;
}
test("OpenCode resolves the single scout with read-only discovery and report-only writes", () => {
    const agent = debugAgent("context-scout");
    assert.equal(actionFor(agent, "codebase-memory_search_graph"), "allow");
    for (const tool of ["index_repository", "delete_project", "manage_adr", "ingest_traces"]) {
        assert.equal(actionFor(agent, `codebase-memory_${tool}`), "deny");
    }
    for (const tool of ["find_symbol", "find_referencing_symbols", "get_symbols_overview", "get_current_config"]) {
        assert.equal(actionFor(agent, `serena_${tool}`), "allow");
    }
    for (const tool of ["activate_project", "replace_symbol_body", "rename_symbol", "create_text_file", "execute_shell_command", "write_memory"]) {
        assert.equal(actionFor(agent, `serena_${tool}`), "deny");
    }
    assert.equal(actionFor(agent, "bash", "sed -n '1,60p' /installation/playbook.md"), "allow");
    for (const command of ["node helper.mjs", "npm test", "touch file", "rm source.mjs"]) {
        assert.equal(actionFor(agent, "bash", command), "deny");
    }
    assert.equal(actionFor(agent, "edit", "/consumer/cache/context.scout.json"), "allow");
    assert.equal(actionFor(agent, "edit", "/consumer/source.mjs"), "deny");
    assert.equal(actionFor(agent, "external_directory", "/installation/*"), "allow");
    assert.equal(agent.tools.write === true || agent.tools.apply_patch === true, true);
    assert.equal(agent.tools.bash, true);
});
test("OpenCode refresher still reads shared installation and writes only context artifacts", () => {
    const agent = debugAgent("context-refresher");
    assert.equal(actionFor(agent, "external_directory", "/outside/project/*"), "allow");
    assert.equal(actionFor(agent, "edit", "/outside/project/source.mjs"), "deny");
});
