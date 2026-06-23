import { sharedStrykerConfig } from "@bedrock-rbx/testing/stryker";
import type { PartialStrykerOptions } from "@stryker-mutator/api/core";

export default {
	...sharedStrykerConfig,
	// src/main.ts is the coverage-excluded composition-root shim (see
	// vite.config.ts).
	mutate: [...sharedStrykerConfig.mutate, "!src/main.ts"],
} satisfies PartialStrykerOptions;
