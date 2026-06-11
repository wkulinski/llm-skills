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
        lines.push(...parsed.errors.filter((error) => typeof error === "string"));
    }

    if (parsed.files && typeof parsed.files === "object" && !Array.isArray(parsed.files)) {
        for (const [filePath, fileReport] of Object.entries(parsed.files)) {
            lines.push(...formatFileMessages(filePath, fileReport));
        }
    }

    return lines;
}

function formatFileMessages(filePath, fileReport) {
    const messages = Array.isArray(fileReport?.messages) ? fileReport.messages : [];
    return messages.map((message) => {
        const line = Number.isInteger(message?.line) ? `:${message.line}` : "";
        const textMessage = typeof message?.message === "string" ? message.message : JSON.stringify(message);
        return `${filePath}${line} ${textMessage}`;
    });
}

export {
    parsePhpStanJson,
};
