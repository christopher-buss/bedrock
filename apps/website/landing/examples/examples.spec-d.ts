import type { Config, deploy } from "@bedrock-rbx/core";

import { expectTypeOf, it } from "vitest";

import config from "./config.ts";

it("should match the published Config shape", () => {
	expectTypeOf(config).toExtend<Config>();
});

it("should accept a minimal env-only deploy call", () => {
	expectTypeOf<{ environment: string }>().toExtend<Parameters<typeof deploy>[0]>();
});
