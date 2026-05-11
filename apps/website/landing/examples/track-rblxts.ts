import { deploy } from "@bedrock-rbx/core";

// One-off scripts, test fixtures, custom CI: call deploy directly.
// eslint-disable-next-line antfu/no-top-level-await -- script-style sample.
const result = await deploy({ environment: "production" });

if (!result.success) {
	// result.err is a typed DeployError union, no try/catch needed.
	console.error(`deploy failed: ${result.err.kind}`);
}
