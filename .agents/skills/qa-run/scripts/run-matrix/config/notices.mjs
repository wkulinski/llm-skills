import {normalizeCommands} from "./normalizer.mjs";

const MACHINE_PARSER_HINTS = [
    {
        commandPattern: /(?:^|[^a-z0-9_-])phpstan(?:[^a-z0-9_-]|$)/i,
        flagPattern: /--error-format(?:=|\s+)json/i,
        flagSuggestion: "--error-format=json",
        parser: "phpstan-json",
        tool: "PHPStan",
    },
    {
        commandPattern: /(?:^|[^a-z0-9_-])eslint(?:[^a-z0-9_-]|$)/i,
        flagPattern: /(?:--format(?:=|\s+)json|(?:^|\s)-f(?:=|\s+)json)/i,
        flagSuggestion: "--format json",
        parser: "eslint-json",
        tool: "ESLint",
    },
];

function collectConfigNotices(config, activeSections) {
    const notices = [];
    for (const sectionName of config.sectionOrder) {
        if (!activeSections[sectionName]) {
            continue;
        }

        for (const command of normalizeCommands(config, sectionName)) {
            notices.push(...collectCommandConfigNotices(sectionName, command));
        }
    }

    return notices;
}

function collectCommandConfigNotices(sectionName, command) {
    const notices = [];
    for (const hint of MACHINE_PARSER_HINTS) {
        if (!hint.commandPattern.test(command.cmd)) {
            continue;
        }

        if (command.output.parser !== hint.parser) {
            notices.push({
                code: "machine-parser-available",
                command: command.cmd,
                message: `${hint.tool} command uses parser=${command.output.parser}; consider parser=${hint.parser} and ${hint.flagSuggestion}.`,
                parser: command.output.parser,
                recommendedParser: hint.parser,
                section: sectionName,
                severity: "NOTICE",
                tool: hint.tool,
            });
            continue;
        }

        if (!hint.flagPattern.test(command.cmd)) {
            notices.push({
                code: "machine-parser-flag-not-visible",
                command: command.cmd,
                message: `${hint.tool} command uses parser=${hint.parser}, but ${hint.flagSuggestion} is not visible in cmd; ensure the wrapper emits JSON.`,
                parser: command.output.parser,
                recommendedFlag: hint.flagSuggestion,
                section: sectionName,
                severity: "NOTICE",
                tool: hint.tool,
            });
        }
    }

    return notices;
}

export {
    collectCommandConfigNotices,
    collectConfigNotices,
};
