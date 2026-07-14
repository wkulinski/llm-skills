#!/usr/bin/env node
import {readSync} from "node:fs";

export const DIRTY_TREE_STRATEGIES = [
    {
        id: "stash",
        label: "Stashuj zmiany",
        description: "Zachowaj zmiany w stashu i utwórz czysty branch z bazy.",
    },
    {
        id: "commit-wip",
        label: "Zapisz commit WIP na bieżącym branchu",
        description: "Dodaj wszystkie bieżące zmiany do commita WIP, potem utwórz branch z bazy.",
    },
    {
        id: "move-to-new-branch",
        label: "Przenieś zmiany na nowy branch",
        description: "Utwórz branch z bazy i zastosuj na nim bieżące zmiany.",
    },
    {
        id: "other",
        label: "Inne",
        description: "Wpisz własną instrukcję dla agenta.",
    },
];

const STRATEGY_IDS = new Set(DIRTY_TREE_STRATEGIES.map(({id}) => id));

export function run(command, args, execCommand) {
    const result = execCommand(command, args);
    return {
        code: result.status ?? 1,
        stderr: String(result.stderr ?? ""),
        stdout: String(result.stdout ?? ""),
    };
}

export function commandFailure(command, args, result) {
    const details = result.stderr.trim() || result.stdout.trim() || `kod wyjścia ${result.code}`;
    return `Nie udało się wykonać: ${command} ${args.join(" ")} (${details}).`;
}

export function getDirtyTreeStatus(execCommand) {
    const result = run("git", ["status", "--porcelain=v1", "-uall"], execCommand);

    if (result.code !== 0) {
        return {code: result.code, stderr: commandFailure("git", ["status", "--porcelain=v1", "-uall"], result)};
    }

    return {code: 0, dirty: Boolean(result.stdout.trim()), output: result.stdout};
}

export function normalizeDirtyTreeStrategy(value) {
    const strategy = String(value ?? "").trim().toLowerCase();
    return STRATEGY_IDS.has(strategy) ? strategy : "";
}

function readByte(read, fd) {
    const buffer = Buffer.alloc(1);
    const bytesRead = read(fd, buffer, 0, 1, null);
    return bytesRead > 0 ? buffer[0] : null;
}

function readKey(read, fd) {
    const first = readByte(read, fd);
    if (first === null) {
        return "";
    }

    if (first !== 0x1b) {
        return String.fromCharCode(first);
    }

    const second = readByte(read, fd);
    const third = readByte(read, fd);
    if (second === 0x5b && third === 0x41) { return "up"; }
    if (second === 0x5b && third === 0x42) { return "down"; }
    return "escape";
}

function readLine(read, fd) {
    const characters = [];
    let character;
    while ((character = readByte(read, fd)) !== null) {
        if (character === 0x0a || character === 0x0d) {
            break;
        }
        characters.push(String.fromCharCode(character));
    }
    return characters.join("").trim();
}

function resolveSelectedStrategy({input, output, read, strategy}) {
    if (strategy.id !== "other") {
        return {code: 0, strategy: strategy.id};
    }

    input.setRawMode(false);
    output.write("Wpisz instrukcję dla agenta: ");
    const instruction = readLine(read, input.fd ?? 0);
    return {
        code: instruction ? 16 : 14,
        instruction,
        stderr: instruction ? "" : "Nie podano instrukcji dla opcji Inne.",
    };
}

export function promptDirtyTreeStrategy({input, output, read = readSync} = {}) {
    const stdin = input ?? process.stdin;
    const stdout = output ?? process.stdout;

    if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== "function") {
        return {
            code: 14,
            stderr: "Dirty tree wykryty, ale wejście nie jest interaktywne. Użyj --dirty-strategy <stash|commit-wip|move-to-new-branch|other>.",
        };
    }

    let selected = 0;
    const render = () => {
        stdout.write("\nWykryto bieżące zmiany. Wybierz sposób ich obsługi (strzałki + Enter):\n");
        DIRTY_TREE_STRATEGIES.forEach((strategy, index) => {
            const marker = index === selected ? "❯" : " ";
            stdout.write(`${marker} ${strategy.label} — ${strategy.description}\n`);
        });
    };

    const previousRawMode = stdin.isRaw ?? false;
    stdin.setRawMode(true);
    stdin.resume();

    try {
        render();
        while (true) {
            const key = readKey(read, stdin.fd ?? 0);
            if (key === "up") {
                selected = (selected + DIRTY_TREE_STRATEGIES.length - 1) % DIRTY_TREE_STRATEGIES.length;
                render();
            } else if (key === "down") {
                selected = (selected + 1) % DIRTY_TREE_STRATEGIES.length;
                render();
            } else if (key === "\r" || key === "\n") {
                return resolveSelectedStrategy({input: stdin, output: stdout, read, strategy: DIRTY_TREE_STRATEGIES[selected]});
            } else if (key === "\u0003" || key === "escape") {
                return {code: 130, stderr: "Anulowano wybór obsługi dirty tree."};
            }
        }
    } finally {
        stdin.setRawMode(previousRawMode);
    }
}

export function checkoutBranch({branchName, baseRef, remote, execCommand}) {
    const branchExists = run("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`], execCommand).code === 0;
    const remoteBranchExists = run("git", ["show-ref", "--verify", "--quiet", `refs/remotes/${remote}/${branchName}`], execCommand).code === 0;
    const args = branchExists
        ? ["checkout", branchName]
        : remoteBranchExists
            ? ["checkout", "-b", branchName, "--track", `${remote}/${branchName}`]
            : ["checkout", "-b", branchName, baseRef];
    const result = run("git", args, execCommand);

    if (result.code !== 0) {
        return {code: 15, stderr: commandFailure("git", args, result)};
    }

    const currentBranch = run("git", ["branch", "--show-current"], execCommand);
    if (currentBranch.code !== 0 || currentBranch.stdout.trim() !== branchName) {
        return {
            code: 15,
            stderr: `Checkout nie został potwierdzony. Oczekiwano '${branchName}', aktywny branch to '${currentBranch.stdout.trim() || "nieznany"}'.`,
        };
    }

    return {code: 0, branchName};
}

export function applyDirtyTreeStrategy({strategy, issueNumber, branchName, baseRef, remote, execCommand}) {
    const message = `wip: preserve changes before issue #${issueNumber}`;
    let stashCreated = false;

    if (strategy === "stash" || strategy === "move-to-new-branch") {
        const stash = run("git", ["stash", "push", "--include-untracked", "-m", message], execCommand);
        if (stash.code !== 0) {
            return {code: 15, stderr: commandFailure("git", ["stash", "push", "--include-untracked", "-m", message], stash)};
        }
        stashCreated = true;
    } else if (strategy === "commit-wip") {
        const add = run("git", ["add", "-A"], execCommand);
        if (add.code !== 0) {
            return {code: 15, stderr: commandFailure("git", ["add", "-A"], add)};
        }
        const commit = run("git", ["commit", "-m", message], execCommand);
        if (commit.code !== 0) {
            return {code: 15, stderr: commandFailure("git", ["commit", "-m", message], commit)};
        }
    }

    const checkout = checkoutBranch({branchName, baseRef, remote, execCommand});
    if (checkout.code !== 0) {
        return {...checkout, stashCreated};
    }
    if (strategy === "stash") {
        return {code: 0, branchName, stashCreated};
    }

    if (strategy === "move-to-new-branch") {
        const apply = run("git", ["stash", "apply"], execCommand);
        if (apply.code !== 0) {
            return {
                code: 15,
                stashCreated: true,
                stderr: `${commandFailure("git", ["stash", "apply"], apply)} Stash pozostawiono do ręcznego odzyskania.`,
            };
        }
        const drop = run("git", ["stash", "drop"], execCommand);
        if (drop.code !== 0) {
            return {
                code: 15,
                stashCreated: true,
                stderr: `${commandFailure("git", ["stash", "drop"], drop)} Zastosowane zmiany pozostają na branchu, ale stash nie został usunięty.`,
            };
        }
    }

    return {code: 0, branchName, stashCreated};
}
