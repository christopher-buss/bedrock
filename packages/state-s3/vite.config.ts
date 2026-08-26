import { sharedConfig } from "@bedrock-rbx/vite-config";

// The AWS SDK's `module` build imports its own files without extensions,
// which only a bundler resolves, so loading it under that condition fails
// outright. Dropping `module` picks the build node itself loads, which is
// the one a consumer of this package runs against. Set rather than merged:
// `mergeConfig` concatenates arrays, which would leave `module` ahead.
const CONDITIONS = ["source", "node", "default"];

export default {
	...sharedConfig,
	resolve: { conditions: CONDITIONS },
	ssr: {
		resolve: { conditions: CONDITIONS, externalConditions: CONDITIONS },
	},
};
