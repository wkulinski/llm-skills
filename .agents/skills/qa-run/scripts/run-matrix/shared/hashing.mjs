import {createHash} from "node:crypto";

export function hashBuffer(buffer) {
    return createHash("sha256").update(buffer).digest("hex");
}

export function hashJson(value) {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
