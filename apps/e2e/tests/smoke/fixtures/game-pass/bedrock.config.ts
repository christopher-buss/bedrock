import { defineConfig } from "@bedrock-rbx/core";

// price is omitted so the smoke pass stays off-sale. Roblox caps on-sale
// game passes per universe and Open Cloud has no DELETE, so an on-sale
// fixture saturates the quota over time and breaks future runs.
export default defineConfig({
	environments: { smoke: {} },
	passes: {
		"smoke-pass": {
			name: "Smoke Test Pass",
			description: "Synthetic pass exercised by the e2e smoke suite.",
			icon: { "en-us": "icon.png" },
		},
	},
});
