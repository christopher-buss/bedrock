import { sharedConfig } from "@bedrock/vite-config";

import { mergeConfig } from "vite-plus";

export default mergeConfig(sharedConfig, {
	pack: {
		// @bedrock/ocale is consumed by later slices (drivers, public API
		// re-exports). Slice 1 only scaffolds the package, so src/ does not yet
		// import from it.
		unused: { ignore: ["@bedrock/ocale"] },
	},
});
