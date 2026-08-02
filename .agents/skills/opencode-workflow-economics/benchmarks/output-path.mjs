import {mkdir, writeFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const SKILL_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

export const BENCHMARK_OUTPUT_DIR = resolve(SKILL_ROOT, "../../..", ".owe/benchmarks");

export function benchmarkOutputPath(filename) {
    return resolve(BENCHMARK_OUTPUT_DIR, filename);
}

export async function writeBenchmarkOutput(outputPath, value) {
    await mkdir(dirname(outputPath), {recursive: true});
    await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, {mode: 0o600});
}
