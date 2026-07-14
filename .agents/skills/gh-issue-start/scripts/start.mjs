#!/usr/bin/env node
import {spawnSync} from "node:child_process";
import {fileURLToPath, pathToFileURL} from "node:url";

import {makeIssueBranch} from "../../_shared/scripts/issue-branch.mjs";
import {
    applyDirtyTreeStrategy,
    checkoutBranch,
    getDirtyTreeStatus,
    normalizeDirtyTreeStrategy,
    promptDirtyTreeStrategy,
    run,
} from "../../_shared/scripts/worktree.mjs";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

export function createExecutor({cwd = repoRoot} = {}) {
    return (command, args, options = {}) => spawnSync(command, args, {
        cwd,
        encoding: "utf-8",
        shell: false,
        ...options,
    });
}

export function extractSubjectKeywords(subject) {
    return String(subject ?? "")
        .replace(/^.*?:/, "")
        .replace(/[\[\]]/g, " ")
        .replace(/[\t\n\r]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .split(" ")
        .filter(Boolean)
        .slice(0, 7)
        .join(" ");
}

export function parseArgs(argv) {
    const args = [...argv];
    const parsed = {
        baseRef: "",
        description: "",
        dirtyInstruction: "",
        dirtyStrategy: "",
        issueNumber: "",
        owner: "",
        repo: "",
        title: "",
    };

    while (args.length > 0) {
        const arg = args.shift();
        switch (arg) {
            case "--issue-number":
                parsed.issueNumber = args.shift() ?? "";
                break;
            case "--title":
                parsed.title = args.shift() ?? "";
                break;
            case "--desc":
                parsed.description = args.shift() ?? "";
                break;
            case "--dirty-strategy":
                parsed.dirtyStrategy = args.shift() ?? "";
                break;
            case "--dirty-instruction":
                parsed.dirtyInstruction = args.shift() ?? "";
                break;
            case "--owner":
                parsed.owner = args.shift() ?? "";
                break;
            case "--repo":
                parsed.repo = args.shift() ?? "";
                break;
            case "--base":
                parsed.baseRef = args.shift() ?? "";
                break;
            case "-h":
            case "--help":
                parsed.help = true;
                break;
            default:
                parsed.error = `Unknown argument: ${arg}`;
                return parsed;
        }
    }

    return parsed;
}

function searchIssueByTitle({execCommand, keywords, owner, repo}) {
    if (!keywords) {
        return null;
    }

    const search = run("gh", [
        "search",
        "issues",
        keywords,
        "--repo",
        `${owner}/${repo}`,
        "--state",
        "open",
        "--match",
        "title",
        "--json",
        "number,title",
        "-q",
        String.raw`.[] | "\(.number)\t\(.title)"`,
    ], execCommand);

    const result = search.stdout.trim();
    if (!result) {
        return null;
    }

    const rows = result.split(/\r?\n/).filter(Boolean);
    if (rows.length === 1) {
        return rows[0].split("\t")[0] ?? "";
    }

    return {
        code: 21,
        stderr: `Multiple issues match title keywords:\n${rows.map((row) => {
            const [number, title] = row.split("\t");
            return `- #${number} ${title ?? ""}`;
        }).join("\n")}\n`,
    };
}

function prepareWorktree({baseRef, branchName, dirtyInstruction, dirtyStrategy, execCommand, issueNumber, remote}) {
    const dirtyStatus = getDirtyTreeStatus(execCommand);
    if (dirtyStatus.code !== 0) {
        return dirtyStatus;
    }

    if (!dirtyStatus.dirty) {
        return checkoutBranch({baseRef, branchName, execCommand, remote});
    }

    if (dirtyStrategy === "other") {
        return dirtyInstruction
            ? {code: 16, stdout: `Instrukcja użytkownika dla agenta: ${dirtyInstruction}\n`}
            : {code: 14, stderr: "Strategia 'other' wymaga --dirty-instruction albo wyboru interaktywnego."};
    }

    const selection = dirtyStrategy
        ? {code: 0, strategy: dirtyStrategy}
        : promptDirtyTreeStrategy();
    if (selection.code !== 0) {
        return selection.code === 16
            ? {code: 16, stdout: `Instrukcja użytkownika dla agenta: ${selection.instruction}\n`}
            : selection;
    }

    return applyDirtyTreeStrategy({
        baseRef,
        branchName,
        execCommand,
        issueNumber,
        remote,
        strategy: selection.strategy,
    });
}

function assignCurrentUser({execCommand, issueNumber}) {
    const currentUserResult = run("gh", ["api", "user", "-q", ".login"], execCommand);
    if (currentUserResult.code !== 0 || !currentUserResult.stdout.trim()) {
        return {code: currentUserResult.code || 15, stderr: currentUserResult.stderr || "Nie udało się ustalić bieżącego użytkownika GitHub."};
    }

    const currentUser = currentUserResult.stdout.trim();
    const assigneesResult = run("gh", ["issue", "view", issueNumber, "--json", "assignees", "-q", ".assignees[].login"], execCommand);
    if (assigneesResult.code !== 0) {
        return {code: assigneesResult.code, stderr: assigneesResult.stderr || "Nie udało się odczytać assignee issue."};
    }

    const assignees = assigneesResult.stdout.trim().split(/\r?\n/).filter(Boolean);
    if (assignees.includes(currentUser)) {
        return {code: 0};
    }

    const assign = run("gh", ["issue", "edit", issueNumber, "--add-assignee", currentUser], execCommand);
    return assign.code === 0
        ? {code: 0}
        : {code: assign.code, stderr: assign.stderr || "Nie udało się przypisać bieżącego użytkownika do issue."};
}

export function runIssueStart(argv, {execCommand = createExecutor()} = {}) {
    const parsed = parseArgs(argv);
    if (parsed.error) {
        return {code: 2, stderr: `${parsed.error}\nUsage: issue-start.mjs [--issue-number <number>] [--title <title>] [--desc <description>] [--dirty-strategy <stash|commit-wip|move-to-new-branch|other>] [--dirty-instruction <tekst>] [--owner <owner>] [--repo <repo>] [--base <ref>]\n`};
    }
    if (parsed.help) {
        return {code: 0, stdout: "Usage: issue-start.mjs [--issue-number <number>] [--title <title>] [--desc <description>] [--dirty-strategy <stash|commit-wip|move-to-new-branch|other>] [--dirty-instruction <tekst>] [--owner <owner>] [--repo <repo>] [--base <ref>]\n"};
    }

    let {baseRef, issueNumber, owner, repo, title} = parsed;
    const {description} = parsed;
    const {dirtyInstruction, dirtyStrategy} = parsed;

    if (dirtyStrategy && !normalizeDirtyTreeStrategy(dirtyStrategy)) {
        return {code: 2, stderr: `Nieznana strategia dirty tree: ${dirtyStrategy}. Użyj stash, commit-wip, move-to-new-branch, other albo pomiń parametr dla wyboru strzałkami.\n`};
    }

    if (!owner || !repo) {
        const repoView = run("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], execCommand);
        if (repoView.code !== 0 || !repoView.stdout.trim()) {
            return {code: repoView.code || 7, stderr: repoView.stderr || "Nie udało się ustalić repozytorium GitHub."};
        }
        const repoFull = repoView.stdout.trim();
        [owner, repo] = repoFull.split("/");
    }

    if (!baseRef) {
        const defaultBranch = run("gh", ["repo", "view", `${owner}/${repo}`, "--json", "defaultBranchRef", "-q", ".defaultBranchRef.name"], execCommand);
        if (defaultBranch.code !== 0 || !defaultBranch.stdout.trim()) {
            return {code: defaultBranch.code || 12, stderr: defaultBranch.stderr || "Nie udało się ustalić domyślnej gałęzi repozytorium."};
        }
        baseRef = `origin/${defaultBranch.stdout.trim()}`;
    }

    if (!issueNumber && (description || title)) {
        const keywords = extractSubjectKeywords(description || title);
        const searchResult = searchIssueByTitle({
            execCommand,
            keywords,
            owner,
            repo,
        });

        if (typeof searchResult === "string") {
            issueNumber = searchResult;
        } else if (searchResult && searchResult.code === 21) {
            return searchResult;
        }
    }

    let issueTitle = "";
    if (issueNumber) {
        const issueView = run("gh", ["issue", "view", issueNumber, "--json", "state,title", "-q", ".state + \"\t\" + .title"], execCommand);
        if (!issueView.stdout.trim()) {
            return {code: 13, stderr: `Issue #${issueNumber} not found or inaccessible. Check if it was closed.\n`};
        }

        const [state, titleValue] = issueView.stdout.trim().split("\t");
        if (state !== "OPEN") {
            return {code: 13, stderr: `Issue #${issueNumber} is not open. Check if it was closed.\n`};
        }
        issueTitle = titleValue ?? "";
    }

    if (!issueNumber) {
        if (!title && description) {
            title = description;
        }
        if (!title) {
            return {code: 10, stderr: "Cannot create issue: missing issue number and no title/description found. Provide --issue-number, --title, or --desc.\n"};
        }

        const created = run("gh", ["issue", "create", "--repo", `${owner}/${repo}`, "--title", title, "--body", ""], execCommand);
        if (created.code !== 0) {
            return {code: created.code, stderr: created.stderr};
        }

        const match = created.stdout.match(/\/issues\/([0-9]+)$/m);
        if (!match) {
            return {code: 11, stderr: "Failed to create issue.\n"};
        }

        issueNumber = match[1];
        issueTitle = title;
    }

    const branchName = makeIssueBranch(issueNumber, issueTitle);
    const [remote, baseBranch] = baseRef.includes("/")
        ? [baseRef.split("/")[0], baseRef.split("/").slice(1).join("/")]
        : ["origin", baseRef];

    let result = run("git", ["fetch", remote, baseBranch, "--quiet"], execCommand);
    if (result.code !== 0) {
        return {code: result.code, stderr: result.stderr};
    }

    result = run("git", ["show-ref", "--verify", "--quiet", `refs/remotes/${remote}/${baseBranch}`], execCommand);
    if (result.code !== 0) {
        return {code: 12, stderr: `Missing base ref ${baseRef}.\n`};
    }

    const worktree = prepareWorktree({baseRef, branchName, dirtyInstruction, dirtyStrategy, execCommand, issueNumber, remote});
    if (worktree.code !== 0) {
        return worktree;
    }

    const assignment = assignCurrentUser({execCommand, issueNumber});
    if (assignment.code !== 0) {
        return assignment;
    }

    return {code: 0, stdout: `Issue #${issueNumber} ready on branch ${branchName}.\n`};
}

async function main(argv) {
    const result = runIssueStart(argv);
    if (result.stdout) { process.stdout.write(result.stdout); }
    if (result.stderr) { process.stderr.write(result.stderr); }
    return result.code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main(process.argv.slice(2)).then((code) => {
        process.exitCode = code;
    }).catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
