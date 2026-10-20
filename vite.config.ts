import { sharedConfig } from "@bedrock-rbx/vite-config";

import { defineConfig } from "vite-plus";

function inEveryPackage(globs: ReadonlyArray<string>): Array<string> {
	return globs.map((glob) => `packages/*/${glob}`);
}

export default defineConfig({
	...sharedConfig,
	pack: undefined,
	run: {
		cache: {
			scripts: true,
			tasks: true,
		},
	},
	test: {
		...sharedConfig.test,
		coverage: {
			exclude: inEveryPackage(sharedConfig.test.coverage.exclude),
			include: inEveryPackage(sharedConfig.test.coverage.include),
			provider: sharedConfig.test.coverage.provider,
			reporter: ["text", "json", "html", "lcov"],
		},
		projects: ["packages/*", "apps/*"],
	},
});
