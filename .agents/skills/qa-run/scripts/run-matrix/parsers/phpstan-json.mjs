function parseJsonOrNull(text) {
    if (!text || text.trim().length === 0) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function parsePhpStanJson(text) {
    const parsed = parseJsonOrNull(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
    }

    const lines = [];
    if (Array.isArray(parsed.errors)) {
        for (const error of parsed.errors) {
            if (typeof error === "string") {
                lines.push(error);
            }
        }
    }

    if (parsed.files && typeof parsed.files === "object" && !Array.isArray(parsed.files)) {
        for (const [filePath, fileReport] of Object.entries(parsed.files)) {
            const messages = Array.isArray(fileReport?.messages) ? fileReport.messages : [];
            for (const message of messages) {
                const line = Number.isInteger(message?.line) ? `:${message.line}` : "";
                const textMessage = typeof message?.message === "string" ? message.message : JSON.stringify(message);
                lines.push(`${filePath}${line} ${textMessage}`);
            }
        }
    }

    return lines;
}

export {
    parsePhpStanJson,
};
