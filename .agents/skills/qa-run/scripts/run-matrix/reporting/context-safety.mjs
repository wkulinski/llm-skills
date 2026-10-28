import {detectSecrets} from "../../../../_shared/scripts/secret-detector.mjs";

// Heuristic guard for text that reaches the agent context. Full logs stay local and unchanged.
const OMITTED_LABEL = "<label omitted: possible secret>";
const OMITTED_TEXT = "<omitted: possible secret; see local logs>";

export function containsPossibleSecret(text) {
    return detectSecrets({text}).length > 0;
}

export function contextSafeText(text) {
    return containsPossibleSecret(text) ? OMITTED_TEXT : text;
}

export function contextSafeLines(lines) {
    const safeLines = lines.filter((line) => !containsPossibleSecret(line));
    const omitted = lines.length - safeLines.length;
    if (omitted === 0) {
        return safeLines;
    }

    return [
        ...safeLines,
        `${omitted} diagnostic line(s) omitted: possible secret; see local stdout/stderr logs.`,
    ];
}

/**
 * Short identifier of a check: selectors of a targeted test or the matrix command index.
 */
export function commandLabel(command) {
    const label = command.label ?? (Number.isInteger(command.sourceIndex) ? `#${command.sourceIndex}` : "");
    return containsPossibleSecret(label) ? OMITTED_LABEL : label;
}
