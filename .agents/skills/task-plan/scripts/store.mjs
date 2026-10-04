#!/usr/bin/env node

import {isMainModule} from "../../_shared/scripts/is-main-module.mjs";
import {runCli} from "../../_shared/scripts/task-plan/store.mjs";

export * from "../../_shared/scripts/task-plan/store.mjs";

if (isMainModule(import.meta.url)) {
    runCli();
}
