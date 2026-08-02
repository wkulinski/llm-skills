#!/usr/bin/env node
import {writeFile} from "node:fs/promises";
import {pathToFileURL} from "node:url";

export function trim(value = "") {
    return String(value).trim();
}

export function normalize(value = "") {
    return trim(value).normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

export function isFillerItem(value = "") {
    switch (normalize(value)) {
        case "brak zmian":
        case "n/a":
        case "-":
            return true;
        default:
            return false;
    }
}

export function sectionKeyFromLabel(label = "") {
    switch (normalize(label)) {
        case "general":
        case "db":
        case "cli":
            return normalize(label);
        default:
            return null;
    }
}

export function parseCommitMessageDraft(input) {
    const lines = String(input ?? "").split(/\r?\n/);
    let subject = "";
    let subjectSeen = false;
    let currentSection = "";
    const sections = {
        cli: [],
        db: [],
        general: [],
    };

    for (const rawLine of lines) {
        const line = trim(rawLine);
        if (line === "") {
            continue;
        }

        if (line.startsWith("Subject:")) {
            if (subjectSeen) {
                throw new Error("Duplicate Subject line.");
            }

            subject = trim(line.slice("Subject:".length));
            if (subject === "") {
                throw new Error("Empty Subject line.");
            }

            subjectSeen = true;
            currentSection = "";
            continue;
        }

        if (line.endsWith(":")) {
            if (!subjectSeen) {
                throw new Error("Subject line must appear before sections.");
            }

            const label = trim(line.slice(0, -1));
            const sectionKey = sectionKeyFromLabel(label);
            if (!sectionKey) {
                throw new Error(`Unknown section: ${label}`);
            }

            currentSection = sectionKey;
            continue;
        }

        if (line.startsWith("-")) {
            if (!subjectSeen) {
                throw new Error("Subject line must appear before sections.");
            }
            if (currentSection === "") {
                throw new Error(`Bullet item outside of a section: ${line}`);
            }

            const item = trim(line.slice(1));
            if (item === "") {
                throw new Error("Empty bullet item.");
            }
            if (isFillerItem(item)) {
                throw new Error(`Filler bullet is not allowed: ${item}`);
            }

            sections[currentSection].push(item);
            continue;
        }

        throw new Error(`Unknown line format: ${line}`);
    }

    if (subject === "") {
        throw new Error("Missing Subject line.");
    }

    return {sections, subject};
}

function renderSection(title, items) {
    if (items.length === 0) {
        return "";
    }

    return `## ${title}\n${items.map((item) => `- ${item}`).join("\n")}\n\n`;
}

export function renderCommitMessage(draft) {
    const {sections, subject} = draft;
    let message = `${subject}\n`;

    if (sections.general.length > 0 || sections.db.length > 0 || sections.cli.length > 0) {
        message += "\n";
        message += renderSection("Zmiany ogólne", sections.general);
        message += renderSection("Zmiany wpływające na strukturę bazy danych", sections.db);
        message += renderSection("Zmiany API poleceń CLI", sections.cli);
    }

    return message;
}

export async function readCommitMessageDraftFromStdin() {
    const chunks = [];
    for await (const chunk of process.stdin) {
        chunks.push(chunk);
    }
    return chunks.join("");
}

export async function renderCommitMessageDraftToFile({input, outputFile}) {
    const draft = parseCommitMessageDraft(input);
    const message = renderCommitMessage(draft);
    await writeFile(outputFile, message, "utf-8");
    return message;
}

async function main(argv) {
    const args = [...argv];
    let outputFile = "";

    while (args.length > 0) {
        const arg = args.shift();
        switch (arg) {
            case "--output":
                outputFile = args.shift() ?? "";
                break;
            case "-h":
            case "--help":
                process.stderr.write(`Usage:\n  commit-message-render.mjs --output <path>\n`);
                return 0;
            default:
                process.stderr.write(`Unknown argument: ${arg}\n`);
                process.stderr.write(`Usage:\n  commit-message-render.mjs --output <path>\n`);
                return 2;
        }
    }

    if (outputFile === "") {
        process.stderr.write("Missing --output.\n");
        process.stderr.write(`Usage:\n  commit-message-render.mjs --output <path>\n`);
        return 2;
    }

    const input = await readCommitMessageDraftFromStdin();
    await renderCommitMessageDraftToFile({input, outputFile});
    return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main(process.argv.slice(2)).then((code) => {
        process.exitCode = code;
    }).catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
