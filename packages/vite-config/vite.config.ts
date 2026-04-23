import { mergeConfig } from "vite-plus";

import { sharedConfig } from "./src/index.ts";

// Drop the jest-extended setup file: it lives in @bedrock/testing, and
// testing already depends on this package. Importing sharedConfig via a
// relative path keeps the workspace edge-free.
export default mergeConfig(sharedConfig, {
	test: {
		setupFiles: [],
	},
});
