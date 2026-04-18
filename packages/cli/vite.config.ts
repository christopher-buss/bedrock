import { sharedConfig } from "@bedrock/vite-config";

import { mergeConfig } from "vite-plus";

export default mergeConfig(sharedConfig, {
	pack: {
		// Declared ahead of first use; remove this ignore once any src/ file
		// imports from @bedrock/ocale.
		unused: { ignore: ["@bedrock/ocale"] },
	},
});
