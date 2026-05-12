import { defineConfig } from "@bedrock-rbx/core/config";

export default defineConfig({
	environments: {
		production: {
			places: { start: { placeId: "1234567890" } },
			universe: { universeId: "6803861769" },
		},
	},
	passes: {
		"vip-pass": {
			name: "VIP Pass",
			description: "Grants VIP perks.",
			icon: { "en-us": "assets/vip.png" },
			price: 500,
		},
	},
	state: { backend: "gist", gistId: "abc123def456" },
	universe: { voiceChatEnabled: true },
});
