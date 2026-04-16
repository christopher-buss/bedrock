import { sharedStrykerConfig } from "@bedrock/testing/stryker";
import type { PartialStrykerOptions } from "@stryker-mutator/api/core";

export default {
	...sharedStrykerConfig,
	mutate: ["src/**/*.ts", "!src/**/*.d.ts", "!src/**/*.spec.ts"],
} satisfies PartialStrykerOptions;
