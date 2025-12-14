import isentinel, { GLOB_MARKDOWN_CODE } from "@isentinel/eslint-config";

export default isentinel(
	{
		name: "bedrock/root",
		flawless: true,
		ignores: ["!.claude"],
		pnpm: true,
		roblox: false,
		rules: {
			"antfu/consistent-list-newline": "off",
		},
		test: {
			vitest: {
				typecheck: true,
			},
		},
		type: "package",
	},
	{
		files: [GLOB_MARKDOWN_CODE],
		rules: {
			"sonar/no-dead-store": "off",
			"sonar/no-unused-collection": "off",
		},
	},
);
