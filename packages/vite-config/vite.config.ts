import { mergeConfig } from "vite-plus";

import { sharedConfig } from "./src/index.ts";

// Drop the jest-extended setup file: it lives in @bedrock-rbx/testing, and
// testing already depends on this package. Importing sharedConfig via a
// relative path keeps the workspace edge-free.
export default mergeConfig(sharedConfig, {
	test: {
		setupFiles: [],
	},
});
