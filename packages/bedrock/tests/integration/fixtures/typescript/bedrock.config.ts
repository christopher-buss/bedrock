import { defineConfig } from "@bedrock/core";

export default defineConfig({
	environments: { production: {} },
	passes: {
		"vip-pass": {
			name: "VIP Pass",
			description: "Grants VIP perks.",
			icon: { "en-us": "assets/vip-icon.png" },
			price: 500,
		},
	},
});
