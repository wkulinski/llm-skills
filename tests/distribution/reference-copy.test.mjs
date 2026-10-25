import {afterEach, describe, expect, it} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {copy, inventory, main, verify} from "../../distribution/reference-copy.mjs";
import {checkDocumentationLinks} from "../helpers/documentation-links.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporary = [];
const temp = () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "skills-delivery-"));
    temporary.push(directory);
    return directory;
};
const write = (root, relative, data) => {
    fs.mkdirSync(path.dirname(path.join(root, relative)), {recursive: true});
    fs.writeFileSync(path.join(root, relative), data);
};
const read = (root, relative) => fs.readFileSync(path.join(root, relative), "utf8");
const consumer = () => {
    const root = temp();
    execFileSync("git", ["init", "--quiet", root]);
    fs.cpSync(path.join(ROOT, "tests/fixtures/delivery/consumer"), root, {recursive: true});
    write(root, "opencode.jsonc", "{\"consumer\": true}\n");
    write(root, ".env.local", "CONSUMER_PRIVATE_VALUE=preserve-this-fixture\n");
    write(root, ".agents/config/model-hierarchy.json", "{\"consumer\": true}\n");
    write(root, ".agents/qa-run.matrix.json", "{\"consumer\": true}\n");
    return root;
};
const syntheticSource = (content = "first\n") => {
    const root = temp();
    write(root, "distribution/linux-opencode/manifest.json", JSON.stringify({
        version: 1, id: "fixture-v1", trees: [".agents/skills/example"], files: [], consumerOwned: [],
    }));
    write(root, ".agents/skills/example/SKILL.md", "---\nname: example\ndescription: fixture\n---\n# Example\n");
    write(root, ".agents/skills/example/data.txt", content);
    return root;
};
afterEach(() => { for (const root of temporary.splice(0)) { fs.rmSync(root, {recursive: true, force: true}); } });

describe("Linux/OpenCode reference delivery", () => {
    it("keeps the installation contract's local documentation links resolvable", () => {
        expect(checkDocumentationLinks(ROOT, ["docs/INSTALLATION.md"])).toEqual([]);
    });

    it("materializes the real 15-skill closure, shared dependencies, roles and templates as regular files", () => {
        const target = consumer();
        const before = ["AGENTS.md", "opencode.jsonc", ".env.local", ".agents/config/model-hierarchy.json", ".agents/qa-run.matrix.json"]
            .map(relative => [relative, read(target, relative)]);
        const plan = copy(ROOT, target);
        expect(plan.files.map(entry => entry.path)).toEqual(plan.files.map(entry => entry.path).sort());
        expect(plan.applied).toBe(false);
        expect(fs.existsSync(path.join(target, ".agents/skills"))).toBe(false);
        const applied = copy(ROOT, target, {apply: true});
        expect(applied.files).toEqual(plan.files);
        expect(verify(ROOT, target).status).toBe("PASS");
        expect(copy(ROOT, target).operations).toEqual([]);
        const skills = fs.readdirSync(path.join(target, ".agents/skills")).filter(name => name !== "_shared");
        expect(skills).toHaveLength(15);
        for (const entry of applied.files) { expect(fs.lstatSync(path.join(target, entry.path)).isFile()).toBe(true); }
        for (const [relative, data] of before) { expect(read(target, relative)).toBe(data); }
        for (const role of ["context-refresher", "context-scout-fast", "context-scout"]) {
            expect(read(target, `.opencode/agents/${role}.md`)).toContain("mode: subagent");
        }
        expect(read(target, ".opencode/plugins/session-model-env.js")).toContain("shell.env");
        expect(read(target, ".agents/skills-templates/opencode.json.dist")).toContain("YOUR_PROVIDER");
        // Relative JS module imports must resolve within the delivered regular-file set.
        const paths = new Set(applied.files.map(entry => entry.path));
        for (const entry of applied.files.filter(file => /\.(?:mjs|js)$/u.test(file.path))) {
            const text = read(target, entry.path);
            for (const match of text.matchAll(/(?:from\s*|import\s*\()(["'])(\.[^"']+)\1/gu)) {
                expect(paths.has(path.posix.normalize(path.posix.join(path.posix.dirname(entry.path), match[2]))), `${entry.path}: ${match[2]}`).toBe(true);
            }
        }
    });

    it("updates and rolls back only receipt-owned files; preserves unrelated consumer files", () => {
        const first = syntheticSource();
        const second = syntheticSource("second\n");
        write(second, ".agents/skills/example/new.txt", "new\n");
        const target = consumer();
        copy(first, target, {apply: true});
        write(target, ".agents/skills/example/consumer.txt", "mine\n");
        expect(copy(second, target).operations.map(e => e.action).sort()).toEqual(["add", "update"]);
        copy(second, target, {apply: true});
        expect(read(target, ".agents/skills/example/data.txt")).toBe("second\n");
        copy(first, target, {apply: true});
        expect(read(target, ".agents/skills/example/data.txt")).toBe("first\n");
        expect(fs.existsSync(path.join(target, ".agents/skills/example/new.txt"))).toBe(false);
        expect(read(target, ".agents/skills/example/consumer.txt")).toBe("mine\n");
        expect(verify(first, target).status).toBe("PASS");
    });

    it("refuses an existing unmanaged role or configuration template before writing anything", () => {
        const target = consumer();
        write(target, ".opencode/agents/context-scout.md", "consumer role\n");
        expect(() => copy(ROOT, target, {apply: true})).toThrow("Unmanaged file conflict: .opencode/agents/context-scout.md");
        expect(fs.existsSync(path.join(target, ".agents/skills"))).toBe(false);
        expect(read(target, ".opencode/agents/context-scout.md")).toBe("consumer role\n");
    });

    it("refuses locally modified managed files without partially updating other files", () => {
        const first = syntheticSource();
        const second = syntheticSource("second\n");
        const target = consumer();
        copy(first, target, {apply: true});
        write(target, ".agents/skills/example/SKILL.md", "local edit\n");
        expect(() => copy(second, target, {apply: true})).toThrow("Locally modified managed file");
        expect(read(target, ".agents/skills/example/data.txt")).toBe("first\n");
    });

    it("refuses executable-bit modifications", () => {
        const source = syntheticSource();
        const target = consumer();
        copy(source, target, {apply: true});
        fs.chmodSync(path.join(target, ".agents/skills/example/data.txt"), 0o755);
        expect(() => copy(source, target, {apply: true})).toThrow("Locally modified managed file");
    });

    it("reports the precise missing dependency in the source and consumer", () => {
        const source = syntheticSource();
        const target = consumer();
        copy(source, target, {apply: true});
        fs.unlinkSync(path.join(target, ".agents/skills/example/data.txt"));
        expect(() => verify(source, target)).toThrow("Missing dependency: .agents/skills/example/data.txt");
        fs.unlinkSync(path.join(source, ".agents/skills/example/SKILL.md"));
        expect(() => inventory(source)).toThrow("Missing dependency: .agents/skills/example/SKILL.md");
    });

    it("rejects a missing declared shared file instead of silently copying an incomplete tree", () => {
        const source = syntheticSource();
        write(source, ".agents/skills/example/SKILL.md", "---\nname: example\nshared_files:\n  - _shared/missing.mjs\n---\n");
        expect(() => inventory(source)).toThrow("Missing dependency: .agents/skills/_shared/missing.mjs");
    });

    it("rejects missing local script and module dependencies", () => {
        const source = syntheticSource();
        write(source, ".agents/skills/example/SKILL.md", "---\nname: example\n---\nRun <skill_dir>/scripts/missing.mjs\n");
        expect(() => inventory(source)).toThrow("Missing dependency: .agents/skills/example/scripts/missing.mjs");
        write(source, ".agents/skills/example/SKILL.md", "---\nname: example\n---\n");
        write(source, ".agents/skills/example/entry.mjs", "import {missing} from './missing.mjs';\n");
        expect(() => inventory(source)).toThrow("Missing dependency: .agents/skills/example/missing.mjs");
    });

    it("reports missing consumer-owned configuration without creating it", () => {
        const target = temp();
        copy(ROOT, target, {apply: true});
        expect(() => verify(ROOT, target)).toThrow("Missing dependency: .agents/config/model-hierarchy.json");
        expect(fs.existsSync(path.join(target, "opencode.jsonc"))).toBe(false);
    });

    it("rejects source symlinks, destination symlink parents and dangling links", () => {
        const source = syntheticSource();
        const target = consumer();
        fs.symlinkSync("data.txt", path.join(source, ".agents/skills/example/link"));
        expect(() => inventory(source)).toThrow("Symlink forbidden");
        fs.unlinkSync(path.join(source, ".agents/skills/example/link"));
        const external = temp();
        fs.symlinkSync(external, path.join(target, ".agents/skills"));
        expect(() => copy(source, target, {apply: true})).toThrow("Symlink forbidden");
        expect(fs.readdirSync(external)).toEqual([]);
        fs.unlinkSync(path.join(target, ".agents/skills"));
        fs.symlinkSync("nonexistent", path.join(target, ".agents/skills"));
        expect(() => copy(source, target, {apply: true})).toThrow("Symlink forbidden");
    });

    it("rejects receipt traversal and consumer-owned paths", () => {
        const source = syntheticSource();
        const target = consumer();
        for (const relative of ["../outside", "opencode.jsonc", ".env.local"]) {
            const files = [{path: relative, sha256: "a".repeat(64), executable: false}];
            const contentSha256 = createHash("sha256").update(JSON.stringify(files)).digest("hex");
            write(target, ".agents/skills-delivery.json", JSON.stringify({version: 1, manifest: "fixture-v1", contentSha256, files}));
            expect(() => copy(source, target, {apply: true})).toThrow();
        }
        expect(read(target, "opencode.jsonc")).toBe("{\"consumer\": true}\n");
    });

    it("does not delete a locally edited file during rollback", () => {
        const first = syntheticSource();
        const second = syntheticSource("second\n");
        write(second, ".agents/skills/example/new.txt", "new\n");
        const target = consumer();
        copy(second, target, {apply: true});
        write(target, ".agents/skills/example/new.txt", "consumer change\n");
        expect(() => copy(first, target, {apply: true})).toThrow("Locally modified managed file");
        expect(read(target, ".agents/skills/example/new.txt")).toBe("consumer change\n");
    });

    it("exposes the documented CLI help/list/dry-run/apply/verify contract", () => {
        expect(main(["--help"]).usage).toContain("--apply");
        const source = syntheticSource();
        const target = consumer();
        const cli = (...args) => JSON.parse(execFileSync(process.execPath, [path.join(ROOT, "distribution/reference-copy.mjs"), ...args], {encoding: "utf8"}));
        expect(cli("list", source)).toHaveLength(2);
        expect(cli("copy", source, target).applied).toBe(false);
        expect(cli("copy", source, target, "--apply").applied).toBe(true);
        expect(cli("verify", source, target).status).toBe("PASS");
        expect(() => main(["copy", source, target, "--force"])).toThrow("Invalid arguments");
        expect(() => main(["copy", source, target, "--apply", "--force"])).toThrow("Invalid arguments");
    });

    it("installs and updates full payloads exported from pinned fixture commits using the documented CLI", () => {
        // Synthetic Git history only: no commits or config changes in the real catalog/consumer.
        const repository = temp();
        const {entries} = inventory(ROOT);
        for (const entry of entries.values()) {
            const destination = path.join(repository, entry.source);
            fs.mkdirSync(path.dirname(destination), {recursive: true});
            fs.copyFileSync(path.join(ROOT, entry.source), destination);
        }
        for (const relative of ["distribution/reference-copy.mjs", "distribution/linux-opencode/manifest.json"]) {
            write(repository, relative, read(ROOT, relative));
        }
        const git = (...args) => execFileSync("git", ["-C", repository, ...args], {encoding: "utf8"});
        git("init", "--quiet");
        const commit = message => {
            git("add", ".");
            git("-c", "user.name=Delivery Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", message);
            return git("rev-parse", "HEAD").trim();
        };
        const first = commit("fixture delivery v1");
        write(repository, ".agents/skills/context-refresh/fixture-version.txt", "v2\n");
        const second = commit("fixture delivery v2");
        const exported = [];
        for (const revision of [first, second]) {
            const source = temp();
            const archive = execFileSync("git", ["-C", repository, "archive", revision], {maxBuffer: 64 * 1024 * 1024});
            execFileSync("tar", ["-x", "-C", source], {input: archive});
            exported.push(source);
        }
        const target = consumer();
        const cli = (source, ...args) => JSON.parse(execFileSync(process.execPath, [path.join(source, "distribution/reference-copy.mjs"), ...args], {encoding: "utf8"}));
        const installed = [];
        for (const source of exported) {
            const list = cli(source, "list", source);
            const preview = cli(source, "copy", source, target);
            const result = cli(source, "copy", source, target, "--apply");
            expect(preview.files).toEqual(list);
            expect(result.files).toEqual(list);
            expect(cli(source, "verify", source, target).status).toBe("PASS");
            installed.push(result.contentSha256);
        }
        expect(installed[0]).not.toBe(installed[1]);
        expect(read(target, ".agents/skills/context-refresh/fixture-version.txt")).toBe("v2\n");
        cli(exported[0], "copy", exported[0], target, "--apply");
        expect(cli(exported[0], "verify", exported[0], target).status).toBe("PASS");
        expect(read(target, ".env.local")).toContain("preserve-this-fixture");
        process.stdout.write(`Pinned synthetic consumer smoke: install ${first} payload=${installed[0]}; update ${second} payload=${installed[1]}; rollback PASS; LSM/live-agent not tested\n`);
    });
});
