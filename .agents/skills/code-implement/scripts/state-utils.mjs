import {appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname, isAbsolute, join} from "node:path";
import {fileURLToPath} from "node:url";

export const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

export function resolveCacheRoot(cachePath = process.env.CACHE_PATH || "var/agent/cache") {
    const trimmed = String(cachePath ?? "").replace(/\/+$/, "");
    const display = trimmed || "var/agent/cache";
    return {
        absolute: isAbsolute(display) ? display : join(repoRoot, display),
        display,
    };
}

export function resolveStatePath(cachePath) {
    const cacheRoot = resolveCacheRoot(cachePath);
    return {
        ...cacheRoot,
        absolute: join(cacheRoot.absolute, "code-implement/state.md"),
        display: `${cacheRoot.display}/code-implement/state.md`,
    };
}

export function resolveReadEventsPath(cachePath) {
    const cacheRoot = resolveCacheRoot(cachePath);
    return {
        ...cacheRoot,
        absolute: join(cacheRoot.absolute, "code-implement/read-events.jsonl"),
        display: `${cacheRoot.display}/code-implement/read-events.jsonl`,
    };
}

export function formatLocalDate(now = new Date()) {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

export function formatLocalTime(now = new Date()) {
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
}

export function formatIsoSeconds(now = new Date()) {
    const date = formatLocalDate(now);
    const time = formatLocalTime(now);
    const offsetMinutes = -now.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? "+" : "-";
    const absOffset = Math.abs(offsetMinutes);
    const offsetHours = String(Math.floor(absOffset / 60)).padStart(2, "0");
    const offsetMins = String(absOffset % 60).padStart(2, "0");
    return `${date}T${time}${sign}${offsetHours}:${offsetMins}`;
}

export function ensureParentDir(filePath) {
    mkdirSync(dirname(filePath), {recursive: true});
}

export function readText(filePath) {
    return readFileSync(filePath, "utf-8");
}

export function writeText(filePath, content) {
    ensureParentDir(filePath);
    writeFileSync(filePath, content, "utf-8");
}

export function appendJsonLine(filePath, value) {
    ensureParentDir(filePath);
    appendFileSync(filePath, `${JSON.stringify(value)}\n`, {encoding: "utf-8", flag: "a"});
}

export function stateExists(statePath) {
    return existsSync(statePath);
}

export function buildStateTemplate(createdAt) {
    return [
        "# STAN CODE-IMPLEMENT (lokalny, niecommitowany)",
        "",
        "> Ten plik jest lokalny i ignorowany przez git. Służy do utrzymania stanu zadania implementacyjnego między iteracjami.",
        "",
        "## Aktywne zadanie",
        `- Utworzono: ${createdAt}`,
        "- Cel: (uzupełnij)",
        "",
        "### Rejestr wymagań",
        "- R1 (TODO): …",
        "  - Kryteria: …",
        "  - Dowody: …",
        "  - Notatki: …",
        "",
        "### Założenia / decyzje",
        "- …",
        "",
        "### Dotknięte obszary",
        "- …",
        "",
        "### Dziennik odczytów",
        `- [${createdAt}] Init`,
        `- [${createdAt}] Przykład: rg "EntityConnection" -n src; git diff --stat`,
        "",
        "### Dziennik iteracji",
        `- [${createdAt}] Init`,
        "",
    ].join("\n");
}

export function insertLogLine(content, heading, logLine) {
    const lines = String(content ?? "").replace(/\s*$/, "").split(/\r?\n/);
    const headingIndex = lines.findIndex((line) => line === heading);

    if (headingIndex === -1) {
        return `${String(content ?? "").replace(/\s*$/, "")}\n\n${heading}\n${logLine}\n`;
    }

    let insertIndex = lines.length;
    for (let index = headingIndex + 1; index < lines.length; index += 1) {
        if (lines[index].startsWith("### ")) {
            insertIndex = index;
            break;
        }
    }

    lines.splice(insertIndex, 0, logLine);
    return `${lines.join("\n")}\n`;
}
