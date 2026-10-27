import assert from "node:assert/strict";
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync} from "node:fs";
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

function fixture(t, {
    auth = identity,
    message = {ts, user: identity.user_id, text: "old"},
    config = {},
    rawConfig,
    users = [],
    channels = [],
    userInfo = {},
    open,
    channelInfo,
    files = {},
    fetchImpl,
} = {}) {
    const root = tempRoot(t);
    const slackDir = path.join(root, ".slack");
    if (typeof rawConfig !== "undefined") {
        mkdirSync(slackDir, {recursive: true, mode: 0o700});
        writeFileSync(path.join(slackDir, "config.json"), JSON.stringify(rawConfig));
    } else {
        writeConfig(root, config);
    }
    writeFileSync(path.join(slackDir, "user-token"), token, {mode: 0o600});
    const calls = [];
    const env = {PATH: process.env.PATH, SLACK_BOT_TOKEN: "inherited-bot", SLACK_USER_TOKEN: "wrong-user"};
    const handlers = {
        "auth.test": () => auth,
        "users.list": currentPayload => typeof users === "function" ? users(currentPayload)
            : {ok: true, members: users, response_metadata: {next_cursor: ""}},
        "users.info": currentPayload => {
            const selected = typeof userInfo === "function"
                ? userInfo(currentPayload.user) : userInfo[currentPayload.user];
            return {ok: true, user: selected
                ?? {id: currentPayload.user, name: "test.user", profile: {display_name: "Test User"}}};
        },
        "conversations.list": currentPayload => {
            const data = typeof channels === "function" ? channels(currentPayload)
                : {ok: true, channels, response_metadata: {next_cursor: ""}};
            if (data.ok === true && currentPayload.exclude_archived === true) {
                return {...data, channels: (data.channels ?? []).filter(item => item.is_archived !== true)};
            }
            return data;
        },
        "conversations.open": currentPayload => {
            if (typeof open === "function") { return open(currentPayload); }
            return open ?? {ok: true, channel: {id: "DTEST", is_im: true, user: currentPayload.users}};
        },
        "conversations.info": currentPayload => {
            const selected = typeof channelInfo === "function"
                ? channelInfo(currentPayload) : channelInfo?.[currentPayload.channel];
            return {ok: true, channel: selected
                ?? {name: "general", is_private: true, is_member: true, is_archived: false}};
        },
        "files.info": currentPayload => {
            const selected = typeof files === "function"
                ? files(currentPayload.file) : files[currentPayload.file];
            if (!selected) { throw new Error("file_not_found"); }
            return {ok: true, file: selected};
        },
        "chat.postMessage": currentPayload => ({ok: true, channel: currentPayload.channel, ts}),
    };
    const request = (method, childEnv, payload) => {
        assert.equal(childEnv.SLACK_USER_TOKEN, token);
        assert.equal(Object.hasOwn(childEnv, "SLACK_BOT_TOKEN"), false);
        calls.push({method, payload});
        if (Object.hasOwn(handlers, method)) { return handlers[method](payload); }
        if (method.startsWith("conversations.")) {
            return {ok: true, messages: [message], has_more: true, response_metadata: {next_cursor: "NEXT"}};
        }
        return {ok: true, channel, ts};
    };
    const options = {cwd: root, env, request, readInput: () => "test", stdinIsTTY: false,
        ...(typeof fetchImpl === "function" ? {fetchImpl} : {})};
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
        ok: true, channel, kind: "channel", name: "general", private: true, member: true,
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

const jan = {
    id: "U00000002", name: "jkowalski", real_name: "Jan Kowalski", team_id: identity.team_id,
    profile: {display_name: "Jan", real_name: "Jan Kowalski", title: "Backend Engineer",
        email: "jan@example.com", phone: "123"},
};
const janDuplicate = {...jan, id: "U00000003", name: "jkowalski2"};
const externalJan = {...jan, id: "U00000004", team_id: "TOTHER"};
const gitHubChannel = {id: "C0ABKTJ7ESV", name: "git-hub", name_normalized: "git-hub",
    is_channel: true, is_private: false, is_archived: false, is_member: true};
const privateChannel = {id: "G00000001", name: "secret-room", name_normalized: "secret-room",
    is_group: true, is_private: true, is_archived: false, is_member: true};
const archivedChannel = {id: "C00000002", name: "old-room", name_normalized: "old-room",
    is_channel: true, is_private: false, is_archived: true, is_member: true};

function channelInfoFor(item) {
    return {[item.id]: {id: item.id, name: item.name, is_channel: item.is_channel,
        is_group: item.is_group, is_private: item.is_private,
        is_archived: item.is_archived, is_member: item.is_member}};
}

function dmFixture(t, options = {}) {
    const dmChannel = "D00000002";
    return fixture(t, {
        users: [jan],
        userInfo: {[jan.id]: jan},
        open: {ok: true, channel: {id: dmChannel, is_im: true, user: jan.id}},
        channelInfo: {[dmChannel]: {id: dmChannel, is_im: true, user: jan.id, is_archived: false}},
        ...options,
    });
}

test("people finds an exact full name and omits private profile fields", t => {
    const f = fixture(t, {users: [jan, {id: "U00000005", name: "annowak", real_name: "Anna Nowak",
        profile: {display_name: "Anna", real_name: "Anna Nowak"}}]});
    const result = f.execute(["people", "Jan Kowalski"]);
    assert.equal(result.ok, true);
    assert.equal(result.ambiguous, false);
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].id, jan.id);
    assert.equal(result.matches[0].match, "exact");
    assert.equal(Object.hasOwn(result.matches[0], "email"), false);
    assert.equal(JSON.stringify(result).includes("jan@example.com"), false);
    assert.equal(JSON.stringify(result).includes("123"), false);
});

test("people reports ambiguous exact matches and paginates the directory", t => {
    const f = fixture(t, {users: [jan, janDuplicate]});
    const result = f.execute(["people", "Jan Kowalski"]);
    assert.equal(result.ambiguous, true);
    assert.equal(result.matches.length, 2);
    assert.equal(result.matches.every(item => item.match === "exact"), true);

    const paged = fixture(t, {users: payload => payload.cursor === "NEXT"
        ? {ok: true, members: [jan], response_metadata: {next_cursor: ""}}
        : {ok: true, members: [], response_metadata: {next_cursor: "NEXT"}}});
    assert.equal(paged.execute(["people", "Jan Kowalski"]).matches[0].id, jan.id);
    assert.equal(paged.calls.filter(call => call.method === "users.list").length, 2);
});

test("send --to unique full name opens DM, sends and writes metadata-only audit", t => {
    const f = dmFixture(t);
    const result = f.execute(["send", "--to", "Jan Kowalski", "--confirm"],
        {readInput: () => "Cześć Jan"});
    assert.equal(result.ok, true);
    assert.equal(result.target.id, jan.id);
    assert.equal(result.channel, "D00000002");
    const open = f.calls.find(call => call.method === "conversations.open");
    assert.deepEqual(open.payload, {users: jan.id, return_im: true, prevent_creation: false});
    const post = f.calls.find(call => call.method === "chat.postMessage");
    assert.deepEqual(post.payload, {channel: "D00000002", text: "Cześć Jan",
        unfurl_links: false, unfurl_media: false});
    const auditFile = path.join(f.root, "var/slack/audit.log");
    const audit = readFileSync(auditFile, "utf8");
    assert.match(audit, /"action":"send"/);
    assert.match(audit, new RegExp(jan.id));
    assert.equal(audit.includes("Cześć Jan"), false);
    assert.equal(audit.includes(token), false);
    assert.equal(statSync(auditFile).mode & 0o777, 0o600);
    assert.equal(JSON.stringify(result).includes(token), false);
});

test("send --to requires confirmation and never guesses on ambiguity or partial names", t => {
    const unconfirmed = dmFixture(t);
    assert.throws(() => unconfirmed.execute(["send", "--to", "Jan Kowalski"],
        {readInput: () => "x"}), /potwierdzenia/);
    assert.equal(unconfirmed.calls.length, 0);

    const ambiguous = fixture(t, {users: [jan, janDuplicate]});
    assert.throws(() => ambiguous.execute(["send", "--to", "Jan Kowalski", "--confirm"],
        {readInput: () => "x"}), /Niejednoznaczne/);
    assert.equal(ambiguous.calls.some(call => call.method === "conversations.open"
        || call.method === "chat.postMessage"), false);

    const partial = dmFixture(t);
    assert.throws(() => partial.execute(["send", "--to", "Jan", "--confirm"],
        {readInput: () => "x"}), /imię i nazwisko/);
    assert.equal(partial.calls.length, 1);
});

test("dm_policy disabled and allowlist are enforced without static person config", t => {
    const disabled = fixture(t, {config: {dm_policy: {mode: "disabled"}}});
    assert.throws(() => disabled.execute(["history", "--to", "Jan Kowalski"]), /wyłączone/);

    const allowed = dmFixture(t, {config: {dm_policy: {mode: "allowlist"},
        direct_messages: {jan: jan.id}}});
    const result = allowed.execute(["history", "--to", "jan"]);
    assert.equal(result.ok, true);
    const open = allowed.calls.find(call => call.method === "conversations.open");
    assert.equal(open.payload.prevent_creation, true);
    const audit = readFileSync(path.join(allowed.root, "var/slack/audit.log"), "utf8");
    assert.match(audit, /"action":"read_history"/);
    assert.equal(audit.includes(token), false);
    assert.equal(allowed.execute(["people", "Jan Kowalski"]).matches[0].id, jan.id);
    assert.throws(() => allowed.execute(["send", "--to", "Jan Kowalski", "--confirm"],
        {readInput: () => "x"}), /allowlist/);
});

test("allow_external and allow_create control dynamic DM behaviour", t => {
    const external = fixture(t, {users: [externalJan]});
    assert.throws(() => external.execute(["send", "--to", "Jan Kowalski", "--confirm"],
        {readInput: () => "x"}), /external/);

    const allowedExternal = dmFixture(t, {config: {dm_policy: {allow_external: true}},
        users: [externalJan], userInfo: {[externalJan.id]: externalJan},
        open: {ok: true, channel: {id: "D00000004", is_im: true, user: externalJan.id}},
        channelInfo: {"D00000004": {id: "D00000004", is_im: true, user: externalJan.id,
            is_archived: false}}});
    assert.equal(allowedExternal.execute(["send", "--to", "Jan Kowalski", "--confirm"],
        {readInput: () => "x"}).ok, true);

    const noCreate = dmFixture(t, {config: {dm_policy: {allow_create: false}}});
    noCreate.execute(["send", "--to", "Jan Kowalski", "--confirm"], {readInput: () => "x"});
    const open = noCreate.calls.find(call => call.method === "conversations.open");
    assert.equal(open.payload.prevent_creation, true);
});

test("minimal empty config still supports status, people lookup and DM send", t => {
    const f = fixture(t, {rawConfig: {}, users: [jan], userInfo: {[jan.id]: jan},
        open: {ok: true, channel: {id: "D00000002", is_im: true, user: jan.id}},
        channelInfo: {"D00000002": {id: "D00000002", is_im: true, user: jan.id,
            is_archived: false}}});
    const status = f.execute(["status"]);
    assert.deepEqual(status.channels, []);
    assert.equal(status.user, "test.user");
    assert.equal(f.execute(["people", "Jan Kowalski"]).matches[0].id, jan.id);
    assert.equal(f.execute(["send", "--to", "Jan Kowalski", "--confirm"],
        {readInput: () => "x"}).ok, true);
});

test("history and files expose only file metadata, never private URLs", t => {
    const fileMessage = {ts, user: identity.user_id, text: "plik", files: [{id: "F1",
        name: "raport.pdf", mimetype: "application/pdf", size: 5,
        url_private: "https://files.slack.com/private",
        url_private_download: "https://files.slack.com/download"}]};
    const f = fixture(t, {message: fileMessage});
    const history = f.execute(["history", channel]);
    const metadata = history.messages[0].files[0];
    assert.equal(metadata.id, "F1");
    assert.equal(metadata.name, "raport.pdf");
    assert.equal(Object.hasOwn(metadata, "url_private"), false);
    assert.equal(Object.hasOwn(metadata, "url_private_download"), false);
    const listed = f.execute(["files", channel, ts]);
    assert.equal(listed.files[0].id, "F1");
    assert.equal(Object.hasOwn(listed.files[0], "url_private"), false);
});

test("download verifies the message attachment and writes a private file", async t => {
    const fetchCalls = [];
    const fetchImpl = async (url, init) => {
        fetchCalls.push({url, init});
        return new Response(new Uint8Array([1, 2, 3, 4, 5]), {status: 200,
            headers: {"content-length": "5"}});
    };
    const f = fixture(t, {message: {ts, user: identity.user_id, text: "plik",
        files: [{id: "F1", name: "raport.pdf"}]}, files: {F1: {id: "F1", name: "raport.pdf",
        mimetype: "application/pdf", size: 5,
        url_private_download: "https://files.slack.com/files-pri/T-F/raport.pdf"}},
    fetchImpl});
    const result = await f.execute(["download", channel, ts, "F1"]);
    assert.equal(result.bytes, 5);
    assert.equal(result.path, "var/slack/files/F1-raport.pdf");
    assert.deepEqual([...readFileSync(path.join(f.root, result.path))], [1, 2, 3, 4, 5]);
    assert.equal(statSync(path.join(f.root, result.path)).mode & 0o777, 0o600);
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].init.headers.Authorization, `Bearer ${token}`);
    assert.equal(fetchCalls[0].url.href, "https://files.slack.com/files-pri/T-F/raport.pdf");
    assert.equal(JSON.stringify(result).includes(token), false);
    const audit = readFileSync(path.join(f.root, "var/slack/audit.log"), "utf8");
    assert.match(audit, /"action":"download"/);
    assert.equal(audit.includes(token), false);
});

test("download rejects external files, foreign hosts and oversized files", async t => {
    const baseMessage = {ts, user: identity.user_id, text: "plik", files: [{id: "F1"}]};
    const external = fixture(t, {message: baseMessage, files: {F1: {id: "F1", name: "x",
        is_external: true, mode: "external", url_private: "https://evil.example/x"}}});
    await assert.rejects(external.execute(["download", channel, ts, "F1"]), /external/);

    let fetched = 0;
    const foreign = fixture(t, {message: baseMessage, files: {F1: {id: "F1", name: "x",
        url_private_download: "https://evil.example/x"}},
    fetchImpl: async () => { fetched += 1; return new Response("x"); }});
    await assert.rejects(foreign.execute(["download", channel, ts, "F1"]), /dozwolonym hoście/);
    assert.equal(fetched, 0);

    const oversized = fixture(t, {config: {files: {max_bytes: 5}}, message: baseMessage,
        files: {F1: {id: "F1", name: "x", size: 10,
            url_private_download: "https://files.slack.com/x"}},
        fetchImpl: async () => { fetched += 1; return new Response("x"); }});
    await assert.rejects(oversized.execute(["download", channel, ts, "F1"]), /limit 5/);
    assert.equal(fetched, 0);
});

test("download follows only allowed redirects and enforces the destination boundary", async t => {
    let requested = 0;
    const redirecting = fixture(t, {message: {ts, user: identity.user_id, text: "plik",
        files: [{id: "F1"}]}, files: {F1: {id: "F1", name: "x",
        url_private_download: "https://files.slack.com/start"}},
    fetchImpl: async () => {
        requested += 1;
        if (requested === 1) {
            return new Response(null, {status: 302, headers: {location: "https://files.slack.com/next"}});
        }
        return new Response("ok", {status: 200});
    }});
    await redirecting.execute(["download", channel, ts, "F1"]);
    assert.equal(requested, 2);
    assert.equal(readFileSync(path.join(redirecting.root, "var/slack/files/F1-x"), "utf8"), "ok");

    let blocked = 0;
    const foreignRedirect = fixture(t, {message: {ts, user: identity.user_id, text: "plik",
        files: [{id: "F1"}]}, files: {F1: {id: "F1", name: "x",
        url_private_download: "https://files.slack.com/start"}},
    fetchImpl: async () => {
        blocked += 1;
        return new Response(null, {status: 302, headers: {location: "https://evil.example/next"}});
    }});
    await assert.rejects(foreignRedirect.execute(["download", channel, ts, "F1"]), /dozwolonym hoście/);
    assert.equal(blocked, 1);

    const traversal = fixture(t, {message: {ts, user: identity.user_id, text: "plik",
        files: [{id: "F1"}]}, files: {F1: {id: "F1", name: "x",
        url_private_download: "https://files.slack.com/x"}}});
    await assert.rejects(traversal.execute(["download", channel, ts, "F1", "--output", "../outside"]),
        /w projekcie/);
});

test("download refuses overwrite without --force and replaces it with --force", async t => {
    const f = fixture(t, {message: {ts, user: identity.user_id, text: "plik",
        files: [{id: "F1"}]}, files: {F1: {id: "F1", name: "x",
        url_private_download: "https://files.slack.com/x"}},
    fetchImpl: async () => new Response("new", {status: 200})});
    const destination = path.join(f.root, "var/slack/files/F1-x");
    mkdirSync(path.dirname(destination), {recursive: true});
    writeFileSync(destination, "old");
    await assert.rejects(f.execute(["download", channel, ts, "F1"]), /już istnieje/);
    await f.execute(["download", channel, ts, "F1", "--force"]);
    assert.equal(readFileSync(destination, "utf8"), "new");
});

test("files accepts a thread root and reads the exact reply", t => {
    const f = fixture(t, {message: {ts, user: identity.user_id, text: "plik",
        files: [{id: "F1", name: "raport.pdf"}]}});
    const result = f.execute(["files", channel, ts, "--thread-ts", "1234567880.000001"]);
    assert.equal(result.files[0].id, "F1");
    const call = f.calls.find(item => item.method === "conversations.replies");
    assert.equal(call.payload.ts, "1234567880.000001");
    assert.equal(call.payload.oldest, ts);
});

test("failed --force download keeps the previous file", async t => {
    const f = fixture(t, {message: {ts, user: identity.user_id, text: "plik",
        files: [{id: "F1"}]}, files: {F1: {id: "F1", name: "x",
        url_private_download: "https://files.slack.com/x"}},
    fetchImpl: async () => { throw new Error("network"); }});
    const destination = path.join(f.root, "var/slack/files/F1-x");
    mkdirSync(path.dirname(destination), {recursive: true});
    writeFileSync(destination, "old");
    await assert.rejects(f.execute(["download", channel, ts, "F1", "--force"]), /network/);
    assert.equal(readFileSync(destination, "utf8"), "old");
});

test("info --to resolves a DM and returns peer metadata", t => {
    const f = dmFixture(t);
    const result = f.execute(["info", "--to", "Jan Kowalski"]);
    assert.equal(result.kind, "im");
    assert.equal(result.peer_user_id, jan.id);
    assert.equal(result.peer_name, "Jan");
    assert.equal(f.calls.filter(call => call.method === "conversations.info").length, 1);
});

test("display-name-only matches require an explicit user ID", t => {
    const displayOnly = {id: "U00000006", name: "jk", real_name: "Jan K.",
        team_id: identity.team_id, profile: {display_name: "Jan Kowalski", real_name: "Jan K."}};
    const f = fixture(t, {users: [displayOnly]});
    const listed = f.execute(["people", "Jan Kowalski"]);
    assert.equal(listed.matches[0].match, "partial");
    assert.equal(listed.ambiguous, true);
    assert.throws(() => f.execute(["send", "--to", "Jan Kowalski", "--confirm"],
        {readInput: () => "x"}), /Brak dokładnego dopasowania/);
    assert.equal(f.calls.some(call => call.method === "chat.postMessage"), false);
});

test("download refuses a symlinked output parent outside the project", async t => {
    const f = fixture(t, {message: {ts, user: identity.user_id, text: "plik",
        files: [{id: "F1"}]}, files: {F1: {id: "F1", name: "x",
        url_private_download: "https://files.slack.com/x"}},
    fetchImpl: async () => new Response("x", {status: 200})});
    const outside = tempRoot(t);
    mkdirSync(path.join(f.root, "var"), {recursive: true});
    symlinkSync(outside, path.join(f.root, "var/slack"));
    await assert.rejects(f.execute(["download", channel, ts, "F1"]), /w projekcie/);
    assert.equal(existsSync(path.join(outside, "files")), false);
});

test("find resolves a channel by displayed name without writing config", t => {
    const f = fixture(t, {channels: [gitHubChannel, privateChannel],
        rawConfig: {channels: ["C0A32SNMQM7"]}});
    const result = f.execute(["find", " #Git Hub"]);
    assert.equal(result.ok, true);
    assert.equal(result.ambiguous, false);
    assert.equal(result.matches[0].id, gitHubChannel.id);
    assert.equal(result.matches[0].match, "exact");
    assert.equal(result.matches[0].private, false);
    assert.equal(f.execute(["find", "secret"]).matches[0].private, true);
    assert.equal(readFileSync(path.join(f.root, ".slack/config.json"), "utf8"),
        JSON.stringify({channels: ["C0A32SNMQM7"]}));
});

test("find --add writes the channel id atomically with mode 600", t => {
    const f = fixture(t, {rawConfig: {dm_policy: {mode: "confirm"}}, channels: [gitHubChannel],
        channelInfo: channelInfoFor(gitHubChannel)});
    const result = f.execute(["find", "git-hub", "--add"]);
    assert.equal(result.added, true);
    assert.equal(result.alias_added, false);
    assert.equal(result.config, ".slack/config.json");
    const configPath = path.join(f.root, ".slack/config.json");
    assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")),
        {dm_policy: {mode: "confirm"}, channels: [gitHubChannel.id]});
    assert.equal(statSync(configPath).mode & 0o777, 0o600);
});

test("find --add --alias is idempotent and rejects alias collisions", t => {
    const f = fixture(t, {rawConfig: {}, channels: [gitHubChannel],
        channelInfo: channelInfoFor(gitHubChannel)});
    const first = f.execute(["find", "git-hub", "--add", "--alias", "github"]);
    assert.equal(first.added, true);
    assert.equal(first.alias_added, true);
    const configPath = path.join(f.root, ".slack/config.json");
    assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")),
        {channels: [gitHubChannel.id], aliases: {github: gitHubChannel.id}});
    const second = f.execute(["find", "git-hub", "--add", "--alias", "github"]);
    assert.equal(second.added, false);
    assert.equal(second.alias_added, false);

    const collision = fixture(t, {rawConfig: {channels: ["C0A32SNMQM7"],
        aliases: {github: "C0A32SNMQM7"}}, channels: [gitHubChannel],
    channelInfo: channelInfoFor(gitHubChannel)});
    assert.throws(() => collision.execute(["find", "git-hub", "--add", "--alias", "github"]),
        /Alias już wskazuje inny kanał/);
    assert.deepEqual(JSON.parse(readFileSync(path.join(collision.root, ".slack/config.json"), "utf8")),
        {channels: ["C0A32SNMQM7"], aliases: {github: "C0A32SNMQM7"}});
});

test("find --add refuses ambiguous and archived channels without writing", t => {
    const duplicate = {...gitHubChannel, id: "C00000003"};
    const ambiguous = fixture(t, {rawConfig: {}, channels: [gitHubChannel, duplicate]});
    assert.throws(() => ambiguous.execute(["find", "git-hub", "--add"]), /Niejednoznaczne/);
    assert.deepEqual(JSON.parse(readFileSync(path.join(ambiguous.root, ".slack/config.json"), "utf8")), {});

    const archived = fixture(t, {rawConfig: {}, channels: [archivedChannel]});
    const listed = archived.execute(["find", "old-room", "--include-archived"]);
    assert.equal(listed.matches[0].archived, true);
    assert.throws(() => archived.execute(["find", "old-room", "--add", "--include-archived"]),
        /archiwalny/);
    assert.deepEqual(JSON.parse(readFileSync(path.join(archived.root, ".slack/config.json"), "utf8")), {});
});

test("find paginates channels and validates add-only flags", t => {
    const paginated = fixture(t, {channels: payload => payload.cursor === "NEXT"
        ? {ok: true, channels: [gitHubChannel], response_metadata: {next_cursor: ""}}
        : {ok: true, channels: [], response_metadata: {next_cursor: "NEXT"}}});
    const result = paginated.execute(["find", "git-hub"]);
    assert.equal(result.matches[0].id, gitHubChannel.id);
    assert.equal(paginated.calls.filter(call => call.method === "conversations.list").length, 2);

    const f = fixture(t, {channels: [gitHubChannel]});
    assert.throws(() => f.execute(["find", "git-hub", "--alias", "github"]), /wymaga --add/);
    assert.throws(() => f.execute(["find", "git-hub", "--add", "--alias", "bad alias"]),
        /Alias może/);
    assert.throws(() => f.execute(["find", "missing", "--add"]), /Brak dokładnego dopasowania/);
});

test("find --remove removes the channel and its aliases idempotently", t => {
    const config = {team_id: identity.team_id, user_id: identity.user_id,
        workspace_url: "https://example.slack.com",
        channels: ["C0A32SNMQM7", gitHubChannel.id],
        aliases: {other: "C0A32SNMQM7", github: gitHubChannel.id}};
    const f = fixture(t, {rawConfig: config, channels: [gitHubChannel]});
    const result = f.execute(["find", "git-hub", "--remove"]);
    assert.equal(result.removed, true);
    assert.deepEqual(result.removed_aliases, ["github"]);
    const configPath = path.join(f.root, ".slack/config.json");
    assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")),
        {team_id: identity.team_id, user_id: identity.user_id,
            workspace_url: "https://example.slack.com",
            channels: ["C0A32SNMQM7"], aliases: {other: "C0A32SNMQM7"}});
    assert.equal(statSync(configPath).mode & 0o777, 0o600);

    const second = f.execute(["find", "git-hub", "--remove"]);
    assert.equal(second.removed, false);
    assert.deepEqual(second.removed_aliases, []);
    assert.match(second.note, /nie jest obecny/);
});

test("find --remove refuses ambiguity and can remove archived configured channels", t => {
    const duplicate = {...gitHubChannel, id: "C00000003"};
    const ambiguous = fixture(t, {rawConfig: {channels: [gitHubChannel.id]},
        channels: [gitHubChannel, duplicate]});
    assert.throws(() => ambiguous.execute(["find", "git-hub", "--remove"]), /Niejednoznaczne/);
    assert.deepEqual(JSON.parse(readFileSync(path.join(ambiguous.root, ".slack/config.json"), "utf8")),
        {channels: [gitHubChannel.id]});

    const archived = fixture(t, {rawConfig: {channels: [archivedChannel.id]},
        channels: [archivedChannel]});
    assert.throws(() => archived.execute(["find", "old-room", "--remove"]),
        /Brak dokładnego dopasowania/);
    const removed = archived.execute(["find", "old-room", "--remove", "--include-archived"]);
    assert.equal(removed.removed, true);

    const conflict = fixture(t, {channels: [gitHubChannel]});
    assert.throws(() => conflict.execute(["find", "git-hub", "--add", "--remove"]),
        /wykluczają/);
    assert.throws(() => conflict.execute(["find", "git-hub", "--remove", "--alias", "github"]),
        /wymaga --add/);
});

test("find --remove accepts the channel id as the lookup key", t => {
    const f = fixture(t, {rawConfig: {channels: [gitHubChannel.id]}, channels: [gitHubChannel]});
    const result = f.execute(["find", gitHubChannel.id, "--remove"]);
    assert.equal(result.removed, true);
    assert.deepEqual(JSON.parse(readFileSync(path.join(f.root, ".slack/config.json"), "utf8")),
        {channels: []});
});
