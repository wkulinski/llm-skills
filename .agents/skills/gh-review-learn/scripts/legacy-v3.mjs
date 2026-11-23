// Migration-only reader for the abandoned compressed format. Never used by normal CLI operations.
import {createHash} from "node:crypto";
import {gunzipSync} from "node:zlib";
import {constants} from "node:buffer";
const fail = (message) => Object.assign(new Error(message), {code: "STORAGE_CONFLICT"});
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const isBase64 = (value) => typeof value === "string" && value.length % 4 === 0 && Buffer.from(value, "base64").toString("base64") === value;
/** Physical V3 is self-contained. Logical V1/V2 remain the public API. */
export function decodeLegacyV3(value) {
    if (value?.schemaVersion !== 3) { return value; }
    if (value.kind !== "lock" || value.entryEncoding !== "gzip-base64" || !Array.isArray(value.entries)) { throw fail("Invalid compact lock envelope"); }
    const entries = value.entries.map((entry) => {
        if (!isBase64(entry?.data) || !Number.isSafeInteger(entry.byteLength) || entry.byteLength < 1 || entry.byteLength > constants.MAX_STRING_LENGTH) { throw fail("Invalid compact lock entry"); }
        let bytes;
        try { bytes = gunzipSync(Buffer.from(entry.data, "base64"), {maxOutputLength: entry.byteLength}); }
        catch { throw fail("Cannot decompress compact lock entry"); }
        if (bytes.length !== entry.byteLength || hash(bytes) !== entry.hash) { throw fail("Compact lock entry hash or length differs"); }
        let decoded;
        try { decoded = JSON.parse(bytes.toString("utf8")); } catch { throw fail("Invalid compact lock entry JSON"); }
        if (decoded?.prId !== entry.prId) { throw fail("Compact lock entry identity differs"); }
        return decoded;
    });
    const {entryEncoding, ...rest} = value;
    return {...rest, schemaVersion: 2, entries};
}
