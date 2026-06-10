export function createOutputCollector(maxTailBytes, maxParserBytes) {
    const parserChunks = [];
    const tailChunks = [];
    let parserBytes = 0;
    let tailBytes = 0;

    return {
        append(chunk) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            if (parserBytes < maxParserBytes) {
                const remainingParserBytes = maxParserBytes - parserBytes;
                const parserChunk = buffer.length <= remainingParserBytes
                    ? buffer
                    : buffer.subarray(0, remainingParserBytes);
                parserChunks.push(parserChunk);
                parserBytes += parserChunk.length;
            }

            tailChunks.push(buffer);
            tailBytes += buffer.length;

            while (tailBytes > maxTailBytes && tailChunks.length > 0) {
                const first = tailChunks[0];
                const overflow = tailBytes - maxTailBytes;
                if (first.length <= overflow) {
                    tailChunks.shift();
                    tailBytes -= first.length;
                    continue;
                }

                tailChunks[0] = first.subarray(overflow);
                tailBytes -= overflow;
            }
        },
        parserContent() {
            return Buffer.concat(parserChunks).toString("utf-8");
        },
        tailContent() {
            return Buffer.concat(tailChunks).toString("utf-8");
        },
    };
}
