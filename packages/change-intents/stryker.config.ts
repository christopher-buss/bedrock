import { sharedStrykerConfig } from "@bedrock-rbx/testing/stryker";
import type { PartialStrykerOptions } from "@stryker-mutator/api/core";

export default {
	...sharedStrykerConfig,
	// CLI composition roots are covered through their orchestration seams (see
	// vite.config.ts).
	mutate: [...sharedStrykerConfig.mutate, "!src/gate-main.ts", "!src/writer-main.ts"],
} satisfies PartialStrykerOptions;
