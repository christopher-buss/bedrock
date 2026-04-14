import isentinel from "@isentinel/eslint-config";

export default isentinel(
	{
		name: "bedrock/root",
		flawless: true,
		ignores: ["!.claude"],
		pnpm: true,
		roblox: false,
		test: {
			vitest: {
				typecheck: true,
			},
		},
		type: "package",
	},
	{
		name: "project/config",
		files: ["*.config.{ts,js}"],
		rules: {
			"flawless/naming-convention": "off",
		},
	},
);
