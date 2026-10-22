import assert from "node:assert/strict";
import {chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {test} from "vitest";

import {addAuthors, createApi, readToken, resolveProjectRoot, run} from "../../../.agents/skills/slack/scripts/slack.mjs";

const channel = "CTEST";
const ts = "1234567890.123456";
const identity = {ok: true, team_id: "TTEST", user_id: "UTEST", team: "Test", user: "test.user"};
const token = "xoxp-offline-fixture";

function tempRoot(t) {
    const directory = mkdtempSync(path.join(tmpdir(), "slack-skill-"));
    t.onTestFinished(() => rmSync(directory, {recursive: true, force: true}));
    return directory;
}

function writeConfig(root, overrides = {}) {
    const slackDir = path.join(root, ".slack");
    mkdirSync(slackDir, {recursive: true, mode: 0o700});
    writeFileSync(path.join(slackDir, "config.json"), JSON.stringify({
        team_id: identity.team_id,
        user_id: identity.user_id,
        channels: [channel],
        aliases: {general: channel},
        workspace_url: "https://example.slack.com",
        ...overrides,
    }));
    return slackDir;
}

function fixture(t, {auth = identity, message = {ts, user: identity.user_id, text: "old"}, config = {}} = {}) {
    const root = tempRoot(t);
    const slackDir = writeConfig(root, config);
    writeFileSync(path.join(slackDir, "user-token"), token, {mode: 0o600});
    const calls = [];
    const env = {PATH: process.env.PATH, SLACK_BOT_TOKEN: "inherited-bot", SLACK_USER_TOKEN: "wrong-user"};
    const request = (method, childEnv, payload) => {
        assert.equal(childEnv.SLACK_USER_TOKEN, token);
        assert.equal(Object.hasOwn(childEnv, "SLACK_BOT_TOKEN"), false);
        calls.push({method, payload});
        if (method === "auth.test") { return auth; }
        if (method === "users.info") {
            return {ok: true, user: {name: "test.user", profile: {display_name: "Test User"}}};
        }
        if (method === "conversations.info") {
            return {ok: true, channel: {name: "general", is_private: true, is_member: true, is_archived: false}};
        }
        if (method.startsWith("conversations.")) {
            return {ok: true, messages: [message], has_more: true, response_metadata: {next_cursor: "NEXT"}};
        }
        return {ok: true, channel, ts};
    };
    const options = {cwd: root, env, request, readInput: () => "test", stdinIsTTY: false};
    return {
        root,
        directory: slackDir,
        calls,
        env,
        options,
        execute: (args, overrides = {}) => run(args, {...options, ...overrides}),
    };
}

test("help needs neither credentials nor network; importing does not run CLI", () => {
    assert.match(run(["--help"], {cwd: "/nonexistent", env: {}}), /history/);
});

test("status authenticates the configured user and preserves caller environment", t => {
    const f = fixture(t);
    const result = f.execute(["status"]);
    assert.equal(result.user, "test.user");
    assert.equal(f.calls.length, 1);
    assert.equal(f.env.SLACK_BOT_TOKEN, "inherited-bot");
    assert.equal(JSON.stringify(result).includes(token), false);
});

test("info and aliases preserve the channel contract", t => {
    const f = fixture(t);
    assert.deepEqual(f.execute(["info", "#general"]), {
        ok: true, channel, name: "general", private: true, member: true,
        archived: false, topic: "", purpose: "",
    });
    assert.deepEqual(f.calls[1], {method: "conversations.info", payload: {channel}});
});

test("foreign channels are rejected before any request for every action", t => {
    const f = fixture(t);
    for (const action of ["info", "history", "thread", "send", "edit", "delete"]) {
        const args = [action, "COTHER", ...(["thread", "edit", "delete"].includes(action) ? [ts] : [])];
        assert.throws(() => f.execute(args), /dozwolonych/);
    }
    assert.equal(f.calls.length, 0);
});

test("wrong project is rejected; project subdirectories are accepted", t => {
    const f = fixture(t);
    const outside = tempRoot(t);
    assert.throws(() => f.execute(["status"], {cwd: outside}), /katalogu projektu/);
    assert.equal(f.calls.length, 0);
    const nested = path.join(f.root, "nested", "deeper");
    mkdirSync(nested, {recursive: true});
    assert.equal(f.execute(["status"], {cwd: nested}).ok, true);
    assert.equal(f.execute(["status"], {cwd: path.join(f.root, ".slack")}).ok, true);
});

test("wrong team, user and bot identity stop before message operations", t => {
    for (const auth of [{...identity, team_id: "TOTHER"}, {...identity, user_id: "UOTHER"}, {...identity, bot_id: "BTEST"}]) {
        const f = fixture(t, {auth});
        assert.throws(() => f.execute(["send", channel]), /workspace/);
        assert.equal(f.calls.length, 1);
    }
});

test("edit/delete need explicit confirmation before requests", t => {
    const f = fixture(t);
    for (const action of ["edit", "delete"]) {
        assert.throws(() => f.execute([action, channel, ts]), /potwierdzenia/);
    }
    assert.equal(f.calls.length, 0);
});

test("stdin guards, UTF-8 and Unicode code point limit are preserved", t => {
    const f = fixture(t);
    assert.throws(() => f.execute(["send", channel], {stdinIsTTY: true}), /standardowe wejście/);
    assert.throws(() => f.execute(["send", channel], {readInput: () => " \n"}), /pustej/);
    assert.throws(() => f.execute(["send", channel], {readInput: () => "😛".repeat(4001)}), /limit/);
    assert.equal(f.calls.length, 0);
    f.execute(["send", "general", "--thread-ts", ts], {readInput: () => "Zażółć gęślą jaźń"});
    assert.deepEqual(f.calls.at(-1), {method: "chat.postMessage", payload: {
        channel, text: "Zażółć gęślą jaźń", unfurl_links: false, unfurl_media: false, thread_ts: ts,
    }});
    assert.equal(f.execute(["send", channel], {readInput: () => "😛".repeat(4000)}).ok, true);
});

test("strict parsing rejects bad commands, timestamps, flags, counts and limits without requests", t => {
    const f = fixture(t);
    for (const args of [[], ["unknown"], ["status", channel], ["send"], ["send", channel, "extra"],
        ["thread", channel, "invalid"], ["send", channel, "--thread-ts", "1"],
        ["history", channel, "--limit", "0"], ["history", channel, "--limit", "101"],
        ["history", channel, "--limit", "1.5"], ["history", channel, "--limit", ""],
        ["send", channel, "--unknown"], ["status", "--confirm"], ["send", channel, "--limit", "1"],
        ["history", channel, "--cursor"]]) {
        assert.throws(() => f.execute(args));
    }
    assert.equal(f.calls.length, 0);
});

test("token is a regular current-user file with exact 0600 and xoxp type", t => {
    const f = fixture(t);
    const filename = path.join(f.directory, "user-token");
    chmodSync(filename, 0o644);
    assert.throws(() => f.execute(["status"]), /prawami 600/);
    chmodSync(filename, 0o600);
    const link = path.join(f.directory, "link");
    symlinkSync(filename, link);
    assert.throws(() => readToken(link), /prawami 600/);
    assert.throws(() => readToken(f.directory), /prawami 600/);
    writeFileSync(filename, "xoxb-not-user");
    assert.throws(() => f.execute(["status"]), /xoxp-/);
    rmSync(filename);
    assert.throws(() => f.execute(["status"]));
    assert.equal(f.calls.length, 0);
});

test("history/thread pagination returns one page and resolves author", t => {
    for (const action of ["history", "thread"]) {
        const f = fixture(t);
        const result = f.execute([action, channel, ...(action === "thread" ? [ts] : []), "--limit", "5", "--cursor", "PREVIOUS"]);
        assert.equal(f.calls.length, 3);
        assert.deepEqual(f.calls[1], {method: action === "thread" ? "conversations.replies" : "conversations.history",
            payload: {channel, limit: 5, cursor: "PREVIOUS", ...(action === "thread" ? {ts} : {})}});
        assert.equal(result.has_more, true);
        assert.equal(result.next_cursor, "NEXT");
        assert.equal(result.messages[0].author_name, "Test User");
        assert.equal(result.messages[0].username, "test.user");
    }
});

test("foreign authors, bots and nonexact messages are rejected", t => {
    for (const action of ["edit", "delete"]) {
        for (const message of [{ts, user: "UOTHER"}, {ts, user: "UBOT", bot_id: "B1"},
            {ts: "1234567890.000000", user: identity.user_id}]) {
            const f = fixture(t, {message});
            assert.throws(() => f.execute([action, channel, ts, "--confirm"]), /wyłącznie|Nie znaleziono/);
            assert.equal(f.calls.length, 2);
        }
    }
});

test("own user posts with app/bot metadata are editable and deletable", t => {
    for (const action of ["edit", "delete"]) {
        const f = fixture(t, {message: {ts, user: identity.user_id, bot_id: "B1", app_id: "A1", text: "old"}});
        const result = f.execute([action, channel, ts, "--confirm"]);
        const extra = action === "edit" ? {text: "test", blocks: [], attachments: []} : {};
        assert.deepEqual(f.calls.at(-1), {method: action === "edit" ? "chat.update" : "chat.delete", payload: {channel, ts, ...extra}});
        assert.equal(result.action, action);
    }
});

test("thread reply ownership uses root and exact reply timestamp", t => {
    const f = fixture(t);
    f.execute(["delete", channel, ts, "--confirm", "--thread-ts", "1234567880.000001"]);
    assert.deepEqual(f.calls[1], {method: "conversations.replies", payload: {
        channel, latest: ts, inclusive: true, limit: 10, ts: "1234567880.000001", oldest: ts,
    }});
});

test("editing refuses files, attachments and special blocks", t => {
    for (const extra of [{files: [{}]}, {attachments: [{}]}, {blocks: [{type: "section"}]}]) {
        const f = fixture(t, {message: {ts, user: identity.user_id, ...extra}});
        assert.throws(() => f.execute(["edit", channel, ts, "--confirm"]), /tekstowe/);
        assert.equal(f.calls.length, 2);
    }
});

test("author lookups are deduplicated; absent display name falls back to username", () => {
    const calls = [];
    const messages = [{user: "U1"}, {user: "U1"}, {user: "U2"}, {bot_id: "B1"}];
    addAuthors(messages, {}, (_method, _env, {user}) => {
        calls.push(user);
        return {user: {name: user + "-name", profile: {display_name: user === "U1" ? "Display" : " "}}};
    });
    assert.deepEqual(calls, ["U1", "U2"]);
    assert.equal(messages[0].author_name, "Display");
    assert.equal(messages[1].author_name, "Display");
    assert.equal(messages[2].author_name, "U2-name");
    assert.equal(Object.hasOwn(messages[3], "author_name"), false);
});

test("author lookup failure leaves messages readable with an explicit warning", () => {
    const messages = [{user: "U1", text: "message"}];
    addAuthors(messages, {}, () => { throw new Error("lookup failed"); });
    assert.equal(messages[0].text, "message");
    assert.equal(messages[0].author_name, "U1");
    assert.equal(messages[0].author_lookup_error, "lookup failed");
});

test("CLI uses form vs JSON correctly, explicit cache and env-only secret", t => {
    const f = fixture(t);
    const calls = [];
    const cacheDir = path.join(f.root, "api-cache");
    const request = createApi({cacheDir, spawn: (...args) => {
        calls.push(args);
        return {status: 0, stdout: '{"ok":true}', stderr: token};
    }});
    const env = {PATH: process.env.PATH, SLACK_USER_TOKEN: token};
    request("conversations.history", env, {channel, inclusive: true, limit: 1});
    request("users.info", env, {user: "U1"});
    request("chat.update", env, {channel, ts, text: "new"});
    assert(calls[0][1].includes("inclusive=true"));
    assert(calls[1][1].includes("user=U1"));
    assert(calls[2][1].includes("--json"));
    for (const [executable, args, options] of calls) {
        assert.equal((executable + JSON.stringify(args)).includes(token), false);
        assert.equal(args[args.indexOf("--config-dir") + 1], path.join(cacheDir, "cli"));
        assert.equal(options.cwd, cacheDir);
        assert.equal(options.timeout, 45_000);
        assert.equal(options.env.SLACK_USER_TOKEN, token);
    }
});

test("CLI errors are redacted and ambiguous writes are not retried", t => {
    const f = fixture(t);
    for (const result of [{error: {code: "ETIMEDOUT", message: token}}, {error: {code: "ENOENT", message: token}},
        {status: 1, stdout: token, stderr: token}, {status: 0, stdout: "null"},
        {status: 0, stdout: JSON.stringify({ok: false, error: token})}]) {
        let calls = 0;
        const request = createApi({cacheDir: path.join(f.root, "errors"), spawn: () => { calls++; return result; }});
        assert.throws(() => request("chat.delete", {SLACK_USER_TOKEN: token}, {channel, ts}), error => !error.message.includes(token));
        assert.equal(calls, 1);
    }
});

test("project root resolution supports ancestors, symlinks and the explicit override", t => {
    const root = tempRoot(t);
    writeConfig(root);
    const nested = path.join(root, "one", "two");
    mkdirSync(nested, {recursive: true});
    assert.equal(resolveProjectRoot({cwd: nested, env: {}}), realpathSync(root));
    const linkParent = tempRoot(t);
    const link = path.join(linkParent, "project");
    symlinkSync(root, link);
    assert.equal(resolveProjectRoot({cwd: link, env: {}}), realpathSync(root));
    const outside = tempRoot(t);
    assert.throws(() => resolveProjectRoot({cwd: outside, env: {}}), /katalogu projektu/);
    assert.throws(() => resolveProjectRoot({cwd: outside, env: {SLACK_PROJECT_ROOT: root}}), /katalogu projektu/);
    assert.equal(resolveProjectRoot({cwd: nested, env: {SLACK_PROJECT_ROOT: root}}), realpathSync(root));
    assert.throws(() => resolveProjectRoot({cwd: root, env: {SLACK_PROJECT_ROOT: outside}}), /SLACK_PROJECT_ROOT/);
});

test("explicit roots preserve the project boundary before any request", t => {
    const f = fixture(t);
    const outside = tempRoot(t);
    assert.throws(() => f.execute(["status"], {cwd: outside, env: {...f.env, SLACK_PROJECT_ROOT: f.root}}), /katalogu projektu/);
    assert.throws(() => f.execute(["status"], {cwd: outside, projectRoot: f.root}), /katalogu projektu/);
    assert.equal(f.calls.length, 0);
    assert.equal(f.execute(["status"], {env: {...f.env, SLACK_PROJECT_ROOT: f.root}}).ok, true);
    assert.equal(f.execute(["status"], {projectRoot: f.root}).ok, true);
    assert.throws(() => f.execute(["status"], {cwd: outside, projectRoot: outside}), /katalogu projektu/);
});

test("createApi default cache follows the consumer root, including override", t => {
    const selected = tempRoot(t);
    writeConfig(selected);
    const nested = path.join(selected, "nested");
    mkdirSync(nested);
    const calls = [];
    const spawn = (executable, args, options) => {
        calls.push({executable, args, options});
        return {status: 0, stdout: '{"ok":true}'};
    };
    const overridden = createApi({
        cwd: nested,
        env: {PATH: process.env.PATH, SLACK_PROJECT_ROOT: selected},
        spawn,
    });
    overridden("auth.test", {SLACK_USER_TOKEN: token});
    const cacheDir = path.join(realpathSync(selected), "var/cache/slack");
    assert.equal(calls[0].options.cwd, cacheDir);
    assert.equal(calls[0].args[calls[0].args.indexOf("--config-dir") + 1], path.join(cacheDir, "cli"));

    const discovered = createApi({cwd: selected, env: {PATH: process.env.PATH}, spawn});
    discovered("auth.test", {SLACK_USER_TOKEN: token});
    assert.equal(calls[1].options.cwd, cacheDir);
});
