import { defineConfig } from "@bedrock-rbx/core";

export default defineConfig({
	environments: { smoke: {} },
	passes: {
		"smoke-pass": {
			name: "Smoke Test Pass",
			description: "Synthetic pass exercised by the e2e smoke suite.",
			icon: { "en-us": "icon.png" },
			price: 100,
		},
	},
});
