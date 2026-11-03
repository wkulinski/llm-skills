#!/usr/bin/env node

import process from "node:process";

import {isMainModule} from "../../_shared/scripts/is-main-module.mjs";
import {main} from "./run-matrix/app/run-matrix-app.mjs";
import {parseConfig} from "./run-matrix/config/normalizer.mjs";

if (isMainModule(import.meta.url)) {
    main().catch((error) => {
        console.error(`ERROR: ${error.message}`);
        process.exit(3);
    });
}

export {
    parseConfig,
};
