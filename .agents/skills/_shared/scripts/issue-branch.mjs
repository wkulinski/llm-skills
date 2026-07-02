#!/usr/bin/env node
import {execFileSync} from "node:child_process";
import {pathToFileURL} from "node:url";

export function slugifyIssueBranchTitle(input = "") {
    return transliterateLatin(String(input))
        .normalize("NFKD")
        .replace(/\p{Diacritic}/gu, "")
        .replace(/[^\p{Letter}\p{Number} -]+/gu, "")
        .toLowerCase()
        .replace(/ /g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function transliterateLatin(value) {
    return value.replace(/[ąĄćĆęĘłŁńŃóÓśŚźŹżŻßøØæÆœŒ]/g, (character) => {
        switch (character) {
            case "ą": return "a";
            case "Ą": return "A";
            case "ć": return "c";
            case "Ć": return "C";
            case "ę": return "e";
            case "Ę": return "E";
            case "ł": return "l";
            case "Ł": return "L";
            case "ń": return "n";
            case "Ń": return "N";
            case "ó": return "o";
            case "Ó": return "O";
            case "ś": return "s";
            case "Ś": return "S";
            case "ź": return "z";
            case "Ź": return "Z";
            case "ż": return "z";
            case "Ż": return "Z";
            case "ß": return "ss";
            case "ø": return "o";
            case "Ø": return "O";
            case "æ": return "ae";
            case "Æ": return "AE";
            case "œ": return "oe";
            case "Œ": return "OE";
            default:
                return character;
        }
    });
}

export function makeIssueBranch(issueNumber, title = "") {
    if (!issueNumber) {
        throw new Error("Missing issue number.");
    }

    const slug = slugifyIssueBranchTitle(title) || "issue";
    return `issue/${issueNumber}-${slug}`;
}

export function parseIssueBranch(branch = "", {execCommand = execFileSync} = {}) {
    let value = branch;
    if (!value) {
        const result = execCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], {encoding: "utf-8"});
        value = String(result).trim();
    }

    value = value.replace(/^refs\/heads\//, "");

    const issueMatch = value.match(/^issue\/([0-9]+)(?:-|$)/);
    if (issueMatch) {
        return issueMatch[1];
    }

    const dashMatch = value.match(/^issue-([0-9]+)(?:-|$)/);
    if (dashMatch) {
        return dashMatch[1];
    }

    return null;
}

export function runIssueBranchCli(argv, {execCommand = execFileSync} = {}) {
    const args = [...argv];
    const command = args.shift() ?? "";

    switch (command) {
        case "slugify": {
            return `${slugifyIssueBranchTitle(args.join(" "))}\n`;
        }
        case "make": {
            let issueNumber = "";
            let title = "";
            while (args.length > 0) {
                const arg = args.shift();
                switch (arg) {
                    case "--issue":
                        issueNumber = args.shift() ?? "";
                        break;
                    case "--title":
                        title = args.shift() ?? "";
                        break;
                    case "-h":
                    case "--help":
                        return usage();
                    default:
                        throw new Error(`Unknown argument: ${arg}`);
                }
            }

            if (!issueNumber) {
                throw new Error("Missing --issue.");
            }

            return `${makeIssueBranch(issueNumber, title)}\n`;
        }
        case "parse": {
            let branch = "";
            while (args.length > 0) {
                const arg = args.shift();
                switch (arg) {
                    case "--branch":
                        branch = args.shift() ?? "";
                        break;
                    case "-h":
                    case "--help":
                        return usage();
                    default:
                        throw new Error(`Unknown argument: ${arg}`);
                }
            }

            const issueNumber = parseIssueBranch(branch, {execCommand});
            return issueNumber ? `${issueNumber}\n` : "";
        }
        case "":
        case "-h":
        case "--help":
            return usage();
        default:
            throw new Error(`Unknown command: ${command}`);
    }
}

function usage() {
    return [
        "Usage:",
        "  issue-branch.mjs slugify <title>",
        "  issue-branch.mjs make --issue <number> [--title <title>]",
        "  issue-branch.mjs parse [--branch <branch>]",
        "",
    ].join("\n");
}

async function main(argv) {
    try {
        process.stdout.write(runIssueBranchCli(argv));
        return 0;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.startsWith("Usage:")) {
            process.stderr.write(`${message}\n`);
            return 0;
        }
        process.stderr.write(`${message}\n`);
        return 2;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main(process.argv.slice(2)).then((code) => {
        process.exitCode = code;
    }).catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
