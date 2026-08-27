import { defineConfig } from "@bedrock-rbx/core";

import { BUCKET, ENVIRONMENT, PREFIX, REGION } from "./coordinates.ts";

// Keep the environment empty. A resource here would put Roblox in the path of
// a test about S3.
export default defineConfig({
	environments: { [ENVIRONMENT]: {} },
	plugins: ["@bedrock-rbx/state-s3"],
	state: {
		backend: "s3",
		bucket: BUCKET,
		prefix: PREFIX,
		region: REGION,
	},
});
