#!/usr/bin/env node

import process from "node:process";
import {pathToFileURL} from "node:url";

import {main} from "./run-matrix/app/run-matrix-app.mjs";
import {parseConfig} from "./run-matrix/config/normalizer.mjs";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(`ERROR: ${error.message}`);
        process.exit(3);
    });
}

export {
    parseConfig,
};
