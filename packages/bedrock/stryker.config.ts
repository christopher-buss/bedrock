import { sharedStrykerConfig } from "@bedrock-rbx/testing/stryker";
import type { PartialStrykerOptions } from "@stryker-mutator/api/core";

export default {
	...sharedStrykerConfig,
	// The default also marks test files, which would put `// @ts-nocheck` on
	// the config fixtures the config editor tests read as text.
	disableTypeChecks: "src/**/*.{js,ts,jsx,tsx,html,vue,cts,mts}",
} satisfies PartialStrykerOptions;
