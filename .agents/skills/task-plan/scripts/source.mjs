#!/usr/bin/env node

import {isMainModule} from "../../_shared/scripts/is-main-module.mjs";
import {runCli} from "../../_shared/scripts/task-plan/source.mjs";

export * from "../../_shared/scripts/task-plan/source.mjs";

if (isMainModule(import.meta.url)) {
    runCli();
}
