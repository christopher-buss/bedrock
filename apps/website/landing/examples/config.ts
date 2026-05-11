import { defineConfig } from "@bedrock-rbx/core";

export default defineConfig({
	environments: { production: {} },
	passes: {
		"vip-pass": {
			name: "VIP Pass",
			description: "Grants VIP perks.",
			icon: { "en-us": "assets/vip.png" },
			price: 500,
		},
	},
	state: { backend: "gist", gistId: "abc123def456" },
	universe: { universeId: "5182930447" },
});
