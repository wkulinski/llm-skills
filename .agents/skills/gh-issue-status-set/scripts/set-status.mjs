#!/usr/bin/env node
import {spawnSync} from "node:child_process";
import {fileURLToPath, pathToFileURL} from "node:url";

import {parseIssueBranch} from "../../_shared/scripts/issue-branch.mjs";

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
        fieldName: "Status",
        issueNumber: "",
        owner: "",
        projectNumber: "",
        repo: "",
        status: "",
    };

    while (args.length > 0) {
        const arg = args.shift();
        switch (arg) {
            case "--status":
                parsed.status = args.shift() ?? "";
                break;
            case "--field":
                parsed.fieldName = args.shift() ?? "Status";
                break;
            case "--issue":
                parsed.issueNumber = args.shift() ?? "";
                break;
            case "--owner":
                parsed.owner = args.shift() ?? "";
                break;
            case "--repo":
                parsed.repo = args.shift() ?? "";
                break;
            case "--project-number":
                parsed.projectNumber = args.shift() ?? "";
                break;
            case "-h":
            case "--help":
                parsed.help = true;
                break;
            default:
                parsed.error = `Nieznany argument: ${arg}`;
                return parsed;
        }
    }

    return parsed;
}

function findIssueFromSubject(subject) {
    const match = String(subject ?? "").match(/#([0-9]+)/);
    return match ? match[1] : "";
}

function extractSubjectKeywords(subject) {
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

function searchIssueByTitle({execCommand, keywords, owner, repo}) {
    if (!keywords) {
        return "";
    }

    const search = run("gh", [
        "search",
        "issues",
        `repo:${owner}/${repo} is:issue is:open in:title ${keywords}`,
        "--json",
        "number,title",
        "-q",
        '.[] | "\(.number)\t\(.title)"',
    ], execCommand);

    const result = search.stdout.trim();
    if (!result) {
        return "";
    }

    const rows = result.split(/\r?\n/).filter(Boolean);
    if (rows.length === 1) {
        return rows[0].split("\t")[0] ?? "";
    }

    return {
        code: 21,
        stderr: `Wiele issue pasuje do słów kluczowych w tytule:\n${rows.map((row) => {
            const [number, title] = row.split("\t");
            return `- #${number} ${title ?? ""}`;
        }).join("\n")}\n`,
    };
}

function setFieldValueById({execCommand, fieldName, itemId, owner, projectNumber, projectId, status}) {
    const ownerType = run("gh", ["api", `users/${owner}`, "--jq", ".type"], execCommand).stdout.trim();
    const projectQuery = ownerType === "Organization"
        ? "query($owner:String!, $number:Int!) { organization(login:$owner) { projectV2(number:$number) { id fields(first: 100) { nodes { ... on ProjectV2SingleSelectField { id name options { id name } } ... on ProjectV2Field { id name } } } } } }"
        : ownerType === "User"
            ? "query($owner:String!, $number:Int!) { user(login:$owner) { projectV2(number:$number) { id fields(first: 100) { nodes { ... on ProjectV2SingleSelectField { id name options { id name } } ... on ProjectV2Field { id name } } } } } }"
            : "";

    if (!projectQuery) {
        return {code: 7, stderr: `Nie udało się ustalić typu właściciela dla '${owner}'.\n`};
    }

    const escapedFieldName = fieldName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const escapedStatus = status.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

    const fieldQuery = `((.data.organization.projectV2.fields.nodes // .data.user.projectV2.fields.nodes // []) | map(select(.name=="${escapedFieldName}")) | .[0].id) // empty`;
    const optionQuery = `((.data.organization.projectV2.fields.nodes // .data.user.projectV2.fields.nodes // []) | map(select(.name=="${escapedFieldName}")) | .[0].options // [] | map(select(.name=="${escapedStatus}")) | .[0].id) // empty`;

    const fieldId = run("gh", ["api", "graphql", "-F", "owner=" + owner, "-F", "number=" + projectNumber, "-f", `query=${projectQuery}`, "--jq", fieldQuery], execCommand).stdout.trim();
    const optionId = run("gh", ["api", "graphql", "-F", "owner=" + owner, "-F", "number=" + projectNumber, "-f", `query=${projectQuery}`, "--jq", optionQuery], execCommand).stdout.trim();

    if (!projectId || !fieldId || !optionId) {
        return {
            code: 7,
            stderr: `Nie udało się ustalić ID projektu/pola/statusu dla '${fieldName}' -> '${status}' w projekcie ${owner}/${projectNumber}.\nSprawdź pola: gh project field-list ${owner}/${projectNumber}\n`,
        };
    }

    const edit = run("gh", ["project", "item-edit", "--project-id", projectId, "--id", itemId, "--field-id", fieldId, "--single-select-option-id", optionId], execCommand);
    if (edit.code !== 0) {
        return {
            code: 7,
            stderr: `Nie udało się ustawić statusu '${status}' używając pola '${fieldName}' w projekcie ${owner}/${projectNumber}.\nSprawdź pola: gh project field-list ${owner}/${projectNumber}\n`,
        };
    }

    return {code: 0};
}

export function runIssueStatusSet(argv, {execCommand = createExecutor()} = {}) {
    const parsed = parseArgs(argv);
    if (parsed.error) {
        return {code: 2, stderr: `${parsed.error}\nUżycie: set-status.mjs --status <nazwa> [--field <nazwa>] [--issue <numer>] [--owner <właściciel>] [--repo <repo>] [--project-number <numer>]\n`};
    }
    if (parsed.help) {
        return {code: 0, stdout: "Użycie: set-status.mjs --status <nazwa> [--field <nazwa>] [--issue <numer>] [--owner <właściciel>] [--repo <repo>] [--project-number <numer>]\n"};
    }
    if (!parsed.status) {
        return {code: 8, stderr: "Status jest wymagany. Podaj --status \"<Status>\".\n"};
    }

    let {fieldName, issueNumber, owner, projectNumber, repo, status} = parsed;
    if (!owner || !repo) {
        const repoFull = run("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], execCommand).stdout.trim();
        [owner, repo] = repoFull.split("/");
    }

    if (!issueNumber) {
        const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], execCommand).stdout.trim();
        issueNumber = parseIssueBranch(branch, {execCommand}) || "";
    }
    if (!issueNumber) {
        const subject = run("git", ["log", "-1", "--pretty=%s"], execCommand).stdout.trim();
        issueNumber = findIssueFromSubject(subject);
    }
    if (!issueNumber) {
        const subject = run("git", ["log", "-1", "--pretty=%s"], execCommand).stdout.trim();
        const keywords = extractSubjectKeywords(subject);
        const searchResult = searchIssueByTitle({execCommand, keywords, owner, repo});
        if (typeof searchResult === "string") {
            issueNumber = searchResult;
        } else if (searchResult && searchResult.code === 21) {
            return searchResult;
        }
    }
    if (!issueNumber) {
        return {code: 3, stderr: "Nie można ustalić numeru issue. Podaj --issue lub użyj nazwy brancha issue/<ID>-*.\n"};
    }

    const itemsRaw = run("gh", ["api", "graphql", "-F", "owner=" + owner, "-F", "repo=" + repo, "-F", "number=" + issueNumber, "-f", "query=query($owner:String!, $repo:String!, $number:Int!) { repository(owner:$owner, name:$repo) { issue(number:$number) { projectItems(first: 20) { nodes { id project { id title number } } } } } }", "--jq", '.data.repository.issue.projectItems.nodes[] | "\(.id)\t\(.project.title)\t\(.project.number)"'], execCommand).stdout.trim();

    const addItemToProject = (projNum) => run("gh", ["project", "item-add", projNum, "--owner", owner, "--url", `https://github.com/${owner}/${repo}/issues/${issueNumber}`, "--format", "json", "-q", ".id"], execCommand).stdout.trim();

    let itemId = "";
    if (!itemsRaw) {
        if (!projectNumber) {
            return {code: 4, stderr: `Issue #${issueNumber} nie jest w żadnym ProjectV2. Podaj --project-number, aby je dodać.\n`};
        }

        itemId = addItemToProject(projectNumber);
        if (!itemId) {
            return {code: 6, stderr: `Nie udało się dodać issue #${issueNumber} do projektu o numerze ${projectNumber}.\n`};
        }
    } else {
        const items = itemsRaw.split(/\r?\n/).filter(Boolean);
        if (!projectNumber) {
            if (items.length > 1) {
                return {code: 5, stderr: `Issue #${issueNumber} znajduje się w wielu projektach:\n${items.map((line) => {
                    const [, title, number] = line.split("\t");
                    return `- ${title} (numer ${number}) element=${line.split("\t")[0]}`;
                }).join("\n")}\nPodaj --project-number, aby wybrać.\n`};
            }
            projectNumber = items[0].split("\t")[2] ?? "";
        }

        itemId = items.find((line) => line.split("\t")[2] === projectNumber)?.split("\t")[0] ?? "";
        if (!itemId) {
            itemId = addItemToProject(projectNumber);
            if (!itemId) {
                return {code: 6, stderr: `Issue #${issueNumber} nie należy do projektu o numerze ${projectNumber} i nie udało się go dodać.\n`};
            }
        }
    }

    const projectRef = `${owner}/${projectNumber}`;
    const itemEditHelp = run("gh", ["project", "item-edit", "--help"], execCommand).stdout;
    if (itemEditHelp.includes("--project-id")) {
        const projectQuery = `query($owner:String!, $number:Int!) { ${run("gh", ["api", `users/${owner}`, "--jq", ".type"], execCommand).stdout.trim() === "Organization" ? `organization(login:$owner)` : `user(login:$owner)`} { projectV2(number:$number) { id fields(first: 100) { nodes { ... on ProjectV2SingleSelectField { id name options { id name } } ... on ProjectV2Field { id name } } } } } }`;
        const projectId = run("gh", ["api", "graphql", "-F", "owner=" + owner, "-F", "number=" + projectNumber, "-f", `query=${projectQuery}`, "--jq", ".data.organization.projectV2.id // .data.user.projectV2.id // empty"], execCommand).stdout.trim();
        const outcome = setFieldValueById({
            execCommand,
            fieldName,
            itemId,
            owner,
            projectId,
            projectNumber,
            status,
        });
        if (outcome.code !== 0) {
            return outcome;
        }
    } else {
        const edit = run("gh", ["project", "item-edit", "--project", projectRef, "--id", itemId, "--field", fieldName, "--single-select-option", status], execCommand);
        if (edit.code !== 0) {
            return {code: 7, stderr: `Nie udało się ustawić statusu '${status}' używając pola '${fieldName}' w projekcie ${projectRef}.\nSprawdź pola: gh project field-list ${projectRef}\n`};
        }
    }

    return {code: 0, stdout: `Status '${status}' ustawiony dla issue #${issueNumber} w projekcie ${projectRef} (element ${itemId}).\n`};
}

async function main(argv) {
    const result = runIssueStatusSet(argv);
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
