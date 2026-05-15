import { defineConfig } from "@bedrock-rbx/core";

export default defineConfig({
	environments: {
		production: {},
	},
	passes: {
		"vip-pass": {
			name: "VIP Pass",
			description: "Grants VIP perks.",
			icon: { "en-us": "assets/vip.png" },
			price: 500,
			redacted: true,
		},
	},
	universe: { universeId: "1234567890" },
});
