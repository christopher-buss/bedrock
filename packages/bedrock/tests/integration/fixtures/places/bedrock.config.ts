import { defineConfig } from "@bedrock-rbx/core";

export default defineConfig({
	environments: {
		production: {
			places: { "start-place": { placeId: "4711" } },
		},
	},
	places: {
		"start-place": { filePath: "places/start.rbxl" },
	},
});
