#!/usr/bin/env node

const SENSITIVE_FIELD_PATTERN = /(?:api[_-]?key|password|secret|token)/i;
const PLACEHOLDER_PATTERN = /^(?:\$\{[^}]+\}|<[^>]+>|\{[^}]+\}|\[[^\]]+\]|(?:sk|gh[pousr]|github_pat)[_-](?:<[^>]+>|[*x]+)|\.\.\.|[*x?_-]+|(?:an?|the|your)[-_ ](?:api[-_ ]?)?(?:key|token|secret|value)|(?:api[-_ ]?)?(?:key|token|secret|value)[-_ ]?(?:here|goes|value)|(?:redacted|placeholder|sample|dummy|example))$/i;
const TOKEN_RULES = Object.freeze([
    {
        category: "github-token",
        pattern: /(?<![A-Za-z0-9_-])gh[pousr]_[A-Za-z0-9][A-Za-z0-9_-]{11,}(?![A-Za-z0-9_-])/g,
        minimumBodyLength: 12,
    },
    {
        category: "github-token",
        pattern: /(?<![A-Za-z0-9_-])github_pat_[A-Za-z0-9][A-Za-z0-9_-]{19,}(?![A-Za-z0-9_-])/g,
        minimumBodyLength: 20,
    },
    {
        category: "openai-token",
        pattern: /(?<![A-Za-z0-9_-])sk-proj-[A-Za-z0-9][A-Za-z0-9_-]{19,}(?![A-Za-z0-9_-])/g,
        minimumBodyLength: 20,
    },
    {
        category: "openai-token",
        pattern: /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9][A-Za-z0-9_-]{39,}(?![A-Za-z0-9_-])/g,
        minimumBodyLength: 40,
    },
]);
const PRIVATE_KEY_PATTERN = /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----[\s\S]{32,}?-----END (?:[A-Z0-9]+ )?PRIVATE KEY-----/g;

function fieldPath(parent, key, arrayParent = false) {
    if (arrayParent) { return `${parent}[${key}]`; }
    return parent === "$" ? `$.${key}` : `${parent}.${key}`;
}

function isPlaceholder(value) {
    return PLACEHOLDER_PATTERN.test(String(value).trim());
}

function shannonEntropy(value) {
    if (value.length === 0) { return 0; }
    const counts = new Map();
    for (const character of value) {
        counts.set(character, (counts.get(character) ?? 0) + 1);
    }
    return [...counts.values()].reduce((entropy, count) => {
        const probability = count / value.length;
        return entropy - probability * Math.log2(probability);
    }, 0);
}

function tokenBody(token, category) {
    if (category === "openai-token") {
        return token.replace(/^sk-(?:proj-)?/, "");
    }
    if (token.startsWith("github_pat_")) { return token.slice("github_pat_".length); }
    return token.slice(4);
}

function isTokenFormatPlaceholder(value) {
    if (!/^(?:sk|gh[pousr]|github_pat)[_-][A-Za-z0-9_-]+$/i.test(value)) { return false; }
    return tokenFindings(value, "$").length === 0;
}

function hasTokenEntropy(token, rule) {
    const body = tokenBody(token, rule.category);
    const minimumUniqueCharacters = Math.min(8, Math.ceil(rule.minimumBodyLength * 0.25));
    return body.length >= rule.minimumBodyLength
        && new Set(body).size >= minimumUniqueCharacters
        && shannonEntropy(body) >= 2.5;
}

function tokenFindings(value, field) {
    const findings = [];
    for (const rule of TOKEN_RULES) {
        for (const match of value.matchAll(rule.pattern)) {
            if (hasTokenEntropy(match[0], rule)) {
                findings.push({category: rule.category, field});
            }
        }
    }
    return findings;
}

function assignmentFindings(value, field) {
    const findings = [];
    const assignmentPattern = /(?:^|[^A-Za-z0-9])(?:api[_-]?key|password|secret|token)(?:[^A-Za-z0-9]|$)\s*[:=]\s*(?:"([^"]*)"|'([^']*)'|([^\s,;}\]]+))/gi;
    for (const match of value.matchAll(assignmentPattern)) {
        const assignedValue = match[1] ?? match[2] ?? match[3] ?? "";
        if (assignedValue.length >= 6 && !isPlaceholder(assignedValue) && !isTokenFormatPlaceholder(assignedValue)) {
            findings.push({category: "sensitive-assignment", field});
        }
    }
    return findings;
}

function privateKeyFindings(value, field) {
    return [...value.matchAll(PRIVATE_KEY_PATTERN)].map(() => ({category: "private-key", field}));
}

function concreteSensitiveValue(value, key) {
    const normalized = String(value).trim();
    if (normalized.length < 6 || isPlaceholder(normalized)) { return false; }
    return /password|secret|token|api[_-]?key/i.test(key);
}

function addFindings(target, findings) {
    for (const finding of findings) {
        const key = `${finding.category}\0${finding.field}`;
        if (!target.some((existing) => `${existing.category}\0${existing.field}` === key)) {
            target.push(finding);
        }
    }
}

function walk(value, path, findings, seen) {
    if (typeof value === "string") {
        addFindings(findings, tokenFindings(value, path));
        addFindings(findings, assignmentFindings(value, path));
        addFindings(findings, privateKeyFindings(value, path));
        return;
    }
    if (value === null || typeof value !== "object" || seen.has(value)) { return; }
    seen.add(value);

    for (const [key, child] of Object.entries(value)) {
        const childPath = fieldPath(path, key, Array.isArray(value));
        if (SENSITIVE_FIELD_PATTERN.test(key) && typeof child === "string" && concreteSensitiveValue(child, key)) {
            const knownToken = tokenFindings(child, childPath);
            if (knownToken.length === 0) { addFindings(findings, [{category: "sensitive-field", field: childPath}]); }
        }
        walk(child, childPath, findings, seen);
    }
}

export function detectSecrets(value) {
    const findings = [];
    walk(value, "$", findings, new WeakSet());
    return findings;
}

export function formatSecretValidationErrors(subject, value) {
    const findings = detectSecrets(value);
    if (findings.length === 0) { return []; }
    return [
        `${subject} appears to contain a secret`,
        ...findings.map(({category, field}) => `${subject} secret detail (category=${category}, field=${field})`),
    ];
}
