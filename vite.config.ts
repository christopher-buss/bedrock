import { sharedConfig } from "@bedrock-rbx/vite-config";

import { defineConfig } from "vite-plus";

function inEveryPackage(globs: ReadonlyArray<string>): Array<string> {
	return globs.map((glob) => `packages/*/${glob}`);
}

// The root runs tests and tasks only; packing belongs to each package.
const { pack: _pack, ...rootConfig } = sharedConfig;

export default defineConfig({
	...rootConfig,
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
