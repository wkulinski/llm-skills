function matchGlob(pattern, filePath) {
    return globToRegExp(pattern).test(filePath);
}

function globToRegExp(pattern) {
    let source = "^";

    for (let index = 0; index < pattern.length; index += 1) {
        const char = pattern[index];
        if (char === "*") {
            const replacement = starGlobReplacement(pattern, index);
            source += replacement.source;
            index += replacement.consumed;
            continue;
        }

        if (char === "?") {
            source += "[^/]";
            continue;
        }

        source += escapeRegExp(char);
    }

    source += "$";
    return new RegExp(source);
}

function starGlobReplacement(pattern, index) {
    if (pattern[index + 1] !== "*") {
        return {source: "[^/]*", consumed: 0};
    }

    if (pattern[index + 2] === "/") {
        return {source: "(?:.*/)?", consumed: 2};
    }

    return {source: ".*", consumed: 1};
}

function escapeRegExp(char) {
    return /[\\^$.*+?()[\]{}|]/.test(char) ? `\\${char}` : char;
}

export {
    escapeRegExp,
    globToRegExp,
    matchGlob,
    starGlobReplacement,
};
