import { defineConfig } from "@bedrock/core";

export default defineConfig({
	environments: { production: {} },
	places: {
		"start-place": {
			filePath: "places/start.rbxl",
			placeId: "4711",
		},
	},
});
