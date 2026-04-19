import { sharedStrykerConfig } from "@bedrock/testing/stryker";
import type { PartialStrykerOptions } from "@stryker-mutator/api/core";

export default {
	...sharedStrykerConfig,
} satisfies PartialStrykerOptions;
