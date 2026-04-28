import { defineConfig } from "@bedrock/core";

export default defineConfig({
	environments: {
		production: {
			places: { "start-place": { placeId: "4711" } },
		},
	},
	places: {
		"start-place": {
			description: "The lobby place.",
			displayName: "Start Place",
			filePath: "places/start.rbxl",
			serverSize: 50,
		},
	},
});
