import {copyFileSync, existsSync, mkdirSync, readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

import {parseConfig} from "./normalizer.mjs";

const CONFIG_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_TEMPLATE_REL_PATH = "../../templates/qa-run.matrix.dist.json";

function ensureConfig(configAbsPath) {
    if (existsSync(configAbsPath)) {
        return false;
    }

    const templateAbsPath = path.resolve(CONFIG_DIR, DEFAULT_CONFIG_TEMPLATE_REL_PATH);
    if (!existsSync(templateAbsPath)) {
        throw new Error(`Default QA matrix template not found: ${templateAbsPath}`);
    }

    mkdirSync(path.dirname(configAbsPath), {recursive: true});
    copyFileSync(templateAbsPath, configAbsPath);
    return true;
}

function loadConfig(configAbsPath) {
    const raw = readConfigRaw(configAbsPath);
    return parseConfig(raw, configAbsPath);
}

function readConfigRaw(configAbsPath) {
    try {
        return readFileSync(configAbsPath, "utf-8");
    } catch {
        throw new Error(`Cannot read config file: ${configAbsPath}`);
    }
}

export {
    ensureConfig,
    loadConfig,
    readConfigRaw,
};
