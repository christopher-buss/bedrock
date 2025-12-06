import isentinel, { GLOB_TESTS } from "@isentinel/eslint-config";

export default isentinel(
	{
		flawless: true,
		ignores: ["!.claude"],
		name: "bedrock/root",
		pnpm: true,
		roblox: false,
		test: true,
		type: "package",
	},
	{
		files: [...GLOB_TESTS],
		rules: {
			"vitest/valid-title": [
				"error",
				{
					mustMatch: {
						it: ["^should", "Test title must start with \"should\""],
					},
				},
			],
		},
	},
);
