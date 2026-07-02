#!/usr/bin/env node
import {spawnSync} from "node:child_process";
import {existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import os from "node:os";
import {fileURLToPath, pathToFileURL} from "node:url";

import {parseIssueBranch} from "../../_shared/scripts/issue-branch.mjs";

const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

export function createExecutor({cwd = repoRoot} = {}) {
    return (command, args, options = {}) => spawnSync(command, args, {
        cwd,
        encoding: "utf-8",
        shell: false,
        ...options,
    });
}

function run(command, args, execCommand) {
    const result = execCommand(command, args);
    return {
        code: result.status ?? 1,
        stderr: String(result.stderr ?? ""),
        stdout: String(result.stdout ?? ""),
    };
}

export function parseArgs(argv) {
    const args = [...argv];
    const parsed = {
        baseBranch: "",
        issueNumber: "",
        owner: "",
        repo: "",
        reviewer: "",
        template: "",
    };

    while (args.length > 0) {
        const arg = args.shift();
        switch (arg) {
            case "--issue-number":
                parsed.issueNumber = args.shift() ?? "";
                break;
            case "--reviewer":
                parsed.reviewer = args.shift() ?? "";
                break;
            case "--template":
                parsed.template = args.shift() ?? "";
                break;
            case "--owner":
                parsed.owner = args.shift() ?? "";
                break;
            case "--repo":
                parsed.repo = args.shift() ?? "";
                break;
            case "--base":
                parsed.baseBranch = args.shift() ?? "";
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

function humanizeBranchTitle(branch) {
    const short = String(branch ?? "").split("/").pop() ?? "";
    return short.replace(/^issue-/, "").replace(/^issue\//, "").replace(/-/g, " ").trim();
}

function readReviewersFile(reviewersFile) {
    try {
        return readFileSync(reviewersFile, "utf-8")
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith("#"))[0] ?? "";
    } catch {
        return "";
    }
}

function resolveTemplatePath({templateOverride, cwd}) {
    if (templateOverride) {
        return templateOverride;
    }

    const candidates = [
        join(cwd, ".github/PULL_REQUEST_TEMPLATE.md"),
        join(cwd, ".github/pull_request_template.md"),
    ];
    for (const candidate of candidates) {
        try {
            if (readFileSync(candidate, "utf-8")) {
                return candidate;
            }
        } catch {
            // ignore
        }
    }

    const directory = join(cwd, ".github/PULL_REQUEST_TEMPLATE");
    try {
        const entries = readdirSync(directory, {withFileTypes: true})
            .filter((entry) => entry.isFile())
            .map((entry) => join(directory, entry.name))
            .sort();
        if (entries.length === 1) {
            return entries[0];
        }
        if (entries.length > 1) {
            return {error: 31, stderr: `Multiple PR templates found:\n${entries.map((entry) => `- ${entry}`).join("\n")}\nProvide --template with the chosen path.\n`};
        }
    } catch {
        // ignore
    }

    return "";
}

function createTemporaryBody({branch, baseRef, issueNumber, issueTitle, execCommand, cwd}) {
    const tmpDir = mkdtempSync(join(os.tmpdir(), "gh-issue-review-"));
    const bodyFile = join(tmpDir, "body.md");
    const goalLine = issueTitle ? `#${issueNumber} ${issueTitle}` : humanizeBranchTitle(branch);
    const goalText = goalLine || "_No goal provided._";
    const changesRaw = run("git", ["log", "--oneline", `${baseRef}..HEAD`], execCommand).stdout.trim();
    const changes = changesRaw
        ? changesRaw.split(/\r?\n/).filter(Boolean).slice(0, 5).map((line) => `- ${line}`).join("\n")
        : "- _No change details available._";

    writeFileSync(bodyFile, `## Goal\n${goalText}\n\n## Changes\n${changes}\n\n## QA\n- _Not run._\n\n## Checklist\n- [ ] Docs updated\n- [ ] Migrations\n- [ ] New env vars\n- [ ] Breaking changes\n`, "utf-8");
    return {bodyFile, tmpDir};
}

function matchPullRequestUrl(output) {
    const match = String(output ?? "").match(/https:\/\/github\.com\/[^ ]+\/pull\/[0-9]+/);
    return match ? match[0] : "";
}

export function runIssueReview(argv, {cwd = repoRoot, execCommand = createExecutor({cwd}), reviewersFile = join(scriptDir, "../default-reviewers.txt")} = {}) {
    const parsed = parseArgs(argv);
    if (parsed.error) {
        return {code: 2, stderr: `${parsed.error}\nUsage: gh-issue-review.mjs [--issue-number <number>] [--reviewer <login>] [--template <path>] [--owner <owner>] [--repo <repo>] [--base <branch>]\n`};
    }
    if (parsed.help) {
        return {code: 0, stdout: "Usage: gh-issue-review.mjs [--issue-number <number>] [--reviewer <login>] [--template <path>] [--owner <owner>] [--repo <repo>] [--base <branch>]\n"};
    }

    let {baseBranch, issueNumber, owner, repo, reviewer, template} = parsed;
    let tmpDir = "";
    let prUrl = "";
    let prNumber = "";
    let existingPrState = "";

    try {
        if (!owner || !repo) {
            const repoFull = run("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], execCommand).stdout.trim();
            [owner, repo] = repoFull.split("/");
        }
        if (!baseBranch) {
            baseBranch = run("gh", ["repo", "view", `${owner}/${repo}`, "--json", "defaultBranchRef", "-q", ".defaultBranchRef.name"], execCommand).stdout.trim() || "main";
        }

        const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], execCommand).stdout.trim();
        const subject = run("git", ["log", "-1", "--pretty=%s"], execCommand).stdout.trim();

        if (!issueNumber) {
            issueNumber = parseIssueBranch(branch, {execCommand}) || "";
        }
        if (!issueNumber) {
            const match = subject.match(/#([0-9]+)/);
            issueNumber = match ? match[1] : "";
        }
        if (!issueNumber) {
            return {code: 3, stderr: "Cannot determine issue number. Provide --issue-number or use branch name issue/<ID>-*.\n"};
        }

        const issueView = run("gh", ["issue", "view", issueNumber, "--json", "state,title", "-q", '.state + "\t" + .title'], execCommand);
        if (!issueView.stdout.trim()) {
            return {code: 13, stderr: `Issue #${issueNumber} not found or inaccessible. Check if it was closed.\n`};
        }
        const [issueState, issueTitle] = issueView.stdout.trim().split("\t");
        if (issueState !== "OPEN") {
            return {code: 13, stderr: `Issue #${issueNumber} is not open. Check if it was closed.\n`};
        }

        const currentUser = run("gh", ["api", "user", "-q", ".login"], execCommand).stdout.trim();
        if (!reviewer) {
            const assignees = run("gh", ["issue", "view", issueNumber, "--json", "assignees", "-q", ".assignees[].login"], execCommand)
                .stdout.trim()
                .split(/\r?\n/)
                .filter(Boolean)
                .filter((login) => login !== currentUser);

            if (assignees.length === 1) {
                reviewer = assignees[0];
            } else if (assignees.length > 1) {
                return {code: 21, stderr: `Multiple assignees available for review:\n${assignees.map((assignee) => `- ${assignee}`).join("\n")}\nProvide --reviewer to choose.\n`};
            } else {
                reviewer = readReviewersFile(reviewersFile);
            }

            if (!reviewer) {
                return {code: 22, stderr: `No reviewer selected. Provide --reviewer or add defaults in ${reviewersFile}.\n`};
            }
        }

        const baseRef = `origin/${baseBranch}`;
        let result = run("git", ["fetch", "origin", baseBranch, "--quiet"], execCommand);
        if (result.code !== 0) {
            return {code: result.code, stderr: result.stderr};
        }

        result = run("git", ["show-ref", "--verify", "--quiet", `refs/remotes/${baseRef}`], execCommand);
        if (result.code !== 0) {
            return {code: 12, stderr: `Missing base ref ${baseRef}.\n`};
        }

        result = run("git", ["rebase", baseRef], execCommand);
        if (result.code !== 0) {
            return {code: 42, stderr: "Rebase failed. Resolve conflicts, run 'git rebase --continue', then rerun this script.\n"};
        }

        run("git", ["push", "origin", "HEAD", "--force"], execCommand);

        const existingPrInfo = run("gh", ["pr", "view", "--json", "state,number,url", "-q", '.state + "\t" + (.number|tostring) + "\t" + .url'], execCommand).stdout.trim();
        if (existingPrInfo) {
            [existingPrState, prNumber, prUrl] = existingPrInfo.split("\t");
            if (existingPrState !== "OPEN") {
                prUrl = "";
                prNumber = "";
            }
        }

        if (prUrl && reviewer) {
            const addReviewer = run("gh", ["pr", "edit", prNumber, "--add-reviewer", reviewer], execCommand);
            if (addReviewer.code !== 0) {
                // shell version only reports the failure and continues
            }
        }

        if (!prUrl) {
            const prTitle = issueTitle ? `#${issueNumber} ${issueTitle}` : humanizeBranchTitle(branch);
            let bodyFile = template;

            if (bodyFile) {
                if (!existsSync(bodyFile)) {
                    return {code: 32, stderr: `Template not found: ${bodyFile}\n`};
                }
            } else {
                const templateCandidate = resolveTemplatePath({cwd, templateOverride: template});
                if (typeof templateCandidate === "object" && templateCandidate.error) {
                    return {code: templateCandidate.error, stderr: templateCandidate.stderr};
                }
                if (typeof templateCandidate === "string" && templateCandidate) {
                    bodyFile = templateCandidate;
                } else {
                    const created = createTemporaryBody({
                        branch,
                        baseRef,
                        cwd,
                        execCommand,
                        issueNumber,
                        issueTitle,
                    });
                    tmpDir = created.tmpDir;
                    bodyFile = created.bodyFile;
                }
            }

            const reviewerFlag = reviewer ? ["--reviewer", reviewer] : [];
            const createWithJson = run("gh", ["pr", "create", "--base", baseBranch, "--head", branch, "--title", issueTitle ? `#${issueNumber} ${issueTitle}` : humanizeBranchTitle(branch), "--body-file", bodyFile, ...reviewerFlag, "--json", "url", "-q", ".url"], execCommand);
            prUrl = createWithJson.stdout.trim();
            if (!prUrl) {
                const stderr = createWithJson.stderr.trim();
                if (/unknown flag: --json/i.test(stderr)) {
                    const fallback = run("gh", ["pr", "create", "--base", baseBranch, "--head", branch, "--title", issueTitle ? `#${issueNumber} ${issueTitle}` : humanizeBranchTitle(branch), "--body-file", bodyFile, ...reviewerFlag], execCommand);
                    prUrl = matchPullRequestUrl(`${fallback.stdout}\n${fallback.stderr}`);
                } else if (stderr) {
                    return {code: 41, stderr: `${stderr}\n`};
                }
            }

            if (!prUrl) {
                return {code: 41, stderr: "Failed to create PR.\n"};
            }
        }

        return {
            code: 0,
            stdout: existingPrState === "OPEN" && prUrl ? `PR reused: ${prUrl}\n` : `PR created: ${prUrl}\n`,
        };
    } finally {
        if (tmpDir) {
            rmSync(tmpDir, {force: true, recursive: true});
        }
    }
}

async function main(argv) {
    const result = runIssueReview(argv);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
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
