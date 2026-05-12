import { deploy, getEnvironment } from "@bedrock-rbx/core";

import process from "node:process";

const environment = getEnvironment();
if (!environment.success) {
	console.error(environment.err);
	process.exit(1);
}

const result = await deploy({ environment: environment.data });

if (!result.success) {
	console.error(result.err);
	process.exit(1);
}
