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

function parseEslintJson(text) {
    const parsed = parseJsonOrNull(text);
    if (!Array.isArray(parsed)) {
        return null;
    }

    const lines = [];
    for (const fileReport of parsed) {
        const filePath = typeof fileReport?.filePath === "string" ? fileReport.filePath : "unknown-file";
        const messages = Array.isArray(fileReport?.messages) ? fileReport.messages : [];
        for (const message of messages) {
            const line = Number.isInteger(message?.line) ? `:${message.line}` : "";
            const column = Number.isInteger(message?.column) ? `:${message.column}` : "";
            const rule = typeof message?.ruleId === "string" && message.ruleId.length > 0
                ? ` [${message.ruleId}]`
                : "";
            const textMessage = typeof message?.message === "string" ? message.message : JSON.stringify(message);
            lines.push(`${filePath}${line}${column}${rule} ${textMessage}`);
        }
    }

    return lines;
}

export {
    parseEslintJson,
};
