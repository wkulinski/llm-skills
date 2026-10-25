import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";

// Git's visibility rules exclude private plans, drafts, handoffs and cache.
// Include untracked public guides so a newly authored page is checked before commit.
function visiblePaths(root, patterns = []) {
    return [...new Set(execFileSync("git", [
        "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ...patterns,
    ], {cwd: root, encoding: "utf8"}).split("\0").filter(Boolean))];
}

export function publicDocumentationPaths(root) {
    return visiblePaths(root, ["*.md"])
        .filter(file => (!file.includes("/") || file.startsWith("docs/")) && fs.existsSync(path.join(root, file)))
        .sort();
}

function blank(value) {
    return value.replace(/[^\n]/gu, " ");
}

function prose(text, maskInline = true) {
    let fence = null;
    const unfenced = text.split("\n").map(line => {
        const marker = line.match(/^ {0,3}(`{3,}|~{3,})/u)?.[1];
        if (fence) {
            if (marker?.[0] === fence[0] && marker.length >= fence.length && /^ {0,3}(?:`+|~+)\s*$/u.test(line)) { fence = null; }
            return blank(line);
        }
        if (marker) {
            fence = marker;
            return blank(line);
        }
        return line;
    }).join("\n");
    const uncommented = unfenced.replace(/<!--[^]*?-->/gu, blank);
    return maskInline ? uncommented.replace(/(`+)([^]*?)\1/gu, blank) : uncommented;
}

function normalizeLabel(label) {
    return label.trim().replace(/\s+/gu, " ").toLowerCase();
}

function destination(value) {
    const text = value.trim();
    return (text.startsWith("<") ? text.slice(1, text.indexOf(">")) : text.match(/^(?:\\.|[^\s])+/u)?.[0] ?? "")
        .replace(/\\([\p{P}\p{S}])/gu, "$1");
}

// Balanced parentheses support source paths such as guide(v2).md. Titles may
// contain parentheses without ending the destination early.
function closingParen(text, start) {
    let depth = 1;
    let quote = null;
    let angle = false;
    for (let i = start; i < text.length; i++) {
        const char = text[i];
        if (char === "\\") { i++; continue; }
        if (quote) { if (char === quote) { quote = null; } continue; }
        if (angle) { if (char === ">") { angle = false; } continue; }
        if (char === "<") { angle = true; continue; }
        if ((char === '"' || char === "'") && /\s/u.test(text[i - 1] ?? "")) { quote = char; continue; }
        if (char === "(") { depth++; }
        if (char === ")") {
            depth--;
            if (depth === 0) { return i; }
        }
    }
    return -1;
}

export function markdownLinks(text) {
    let source = prose(text);
    const links = [];
    const definitions = new Map();
    source = source.replace(/^ {0,3}\[([^\]\n]+)\]:\s*(.+)$/gmu, (match, label, target, index) => {
        definitions.set(normalizeLabel(label), destination(target));
        links.push({target: destination(target), index});
        return blank(match);
    });
    const pattern = /!?\[([^\]\n]*)\]/gu;
    for (const match of source.matchAll(pattern)) {
        if (source[match.index - 1] === "\\") { continue; }
        const end = match.index + match[0].length;
        if (source[end] === "(") {
            const close = closingParen(source, end + 1);
            if (close !== -1) { links.push({target: destination(source.slice(end + 1, close)), index: match.index}); }
        } else if (source[end] === "[") {
            const close = source.indexOf("]", end + 1);
            if (close !== -1) {
                const label = normalizeLabel(source.slice(end + 1, close) || match[1]);
                links.push({target: definitions.get(label), index: match.index, label});
            }
        } else if (definitions.has(normalizeLabel(match[1]))) {
            links.push({target: definitions.get(normalizeLabel(match[1])), index: match.index});
        }
    }
    for (const match of source.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/giu)) {
        links.push({target: match[1], index: match.index});
    }
    return links.map(link => ({...link, line: text.slice(0, link.index).split("\n").length}));
}

function anchors(text) {
    const found = new Set();
    const counts = new Map();
    // Keep inline code text for heading slugs (unlike link extraction).
    const source = prose(text, false);
    for (const line of source.split("\n")) {
        const heading = line.match(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/u)?.[1];
        if (typeof heading === "string") {
            const base = heading.toLowerCase().replace(/<[^>]+>/gu, "").replace(/[^\p{L}\p{N}_\-\s]/gu, "").replace(/ /gu, "-");
            let slug = base;
            let count = counts.get(base) ?? 0;
            while (found.has(slug)) { slug = `${base}-${++count}`; }
            counts.set(base, count);
            found.add(slug);
        }
    }
    for (const match of prose(text).matchAll(/<[a-z][^>]*\b(?:id|name)=["']([^"']+)["']/giu)) { found.add(match[1]); }
    return found;
}

export function checkDocumentationLinks(root, documents) {
    const errors = [];
    const anchorCache = new Map();
    const visible = fs.existsSync(path.join(root, ".git")) ? visiblePaths(root) : null;
    for (const file of documents) {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        for (const {target, line, label} of markdownLinks(text)) {
            const prefix = `${file}:${line}:`;
            if (typeof target !== "string") { errors.push(`${prefix} undefined link reference [${label}]`); continue; }
            // External URLs, mail, protocol-relative URLs: deliberately no network I/O.
            if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(target)) { continue; }
            let pathname;
            let fragment;
            try {
                const parts = target.split("#", 2);
                pathname = decodeURIComponent(parts[0]);
                fragment = decodeURIComponent(parts[1] ?? "");
            }
            catch { errors.push(`${prefix} invalid URL encoding: ${target}`); continue; }
            // Examples belong in code, never silently exempt a clickable local link.
            if (/[<>$*{}]/u.test(pathname)) { errors.push(`${prefix} placeholder link must be a code example: ${target}`); continue; }
            const resolved = pathname.startsWith("/")
                ? path.resolve(root, `.${pathname}`)
                : path.resolve(root, path.dirname(file), pathname || path.basename(file));
            if (resolved !== root && !resolved.startsWith(`${path.resolve(root)}${path.sep}`)) {
                errors.push(`${prefix} local link escapes repository: ${target}`);
                continue;
            }
            if (!fs.existsSync(resolved)) { errors.push(`${prefix} missing local target: ${target}`); continue; }
            const relative = path.relative(root, resolved).split(path.sep).join("/");
            if (visible && relative && !visible.some(filePath => filePath === relative || filePath.startsWith(`${relative}/`))) {
                errors.push(`${prefix} local target is not Git-visible (ignored/private): ${target}`);
                continue;
            }
            if (!fragment || !/\.md$/iu.test(resolved)) { continue; }
            if (!anchorCache.has(resolved)) { anchorCache.set(resolved, anchors(fs.readFileSync(resolved, "utf8"))); }
            if (!anchorCache.get(resolved).has(fragment)) { errors.push(`${prefix} missing heading/anchor: ${target}`); }
        }
    }
    return errors;
}
