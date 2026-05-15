import { defineConfig } from "@bedrock-rbx/core";

export default defineConfig({
	environments: {
		dev: {
			passes: { "carve-out-pass": { redacted: false } },
			redacted: true,
		},
		production: {},
	},
	passes: {
		"carve-out-pass": {
			name: "Carve Out",
			description: "Stays real in dev.",
			icon: { "en-us": "assets/carve.png" },
			price: 100,
		},
		"vip-pass": {
			name: "VIP Pass",
			description: "Grants VIP perks.",
			icon: { "en-us": "assets/vip.png" },
			price: 500,
		},
	},
	universe: { universeId: "1234567890" },
});
