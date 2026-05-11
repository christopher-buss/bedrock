import { deploy } from "@bedrock-rbx/core";

// eslint-disable-next-line antfu/no-top-level-await -- script-style sample; reflects how users invoke deploy from a one-shot file.
const result = await deploy({ environment: "production" });

if (!result.success) {
	console.error(result.err);
}
