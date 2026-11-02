// Vitest setup file: runs in each worker before its test file loads, so no
// test sees a credential that the developer's shell happens to export.
import process from "node:process";

import { isolateEnvironment, TEST_ENVIRONMENT_ALLOWLIST } from "./isolated-environment.ts";

isolateEnvironment(process.env, TEST_ENVIRONMENT_ALLOWLIST);
