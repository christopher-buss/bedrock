import isentinel, { GLOB_MARKDOWN_CODE, GLOB_SRC } from "@isentinel/eslint-config";

export default isentinel(
	{
		name: "bedrock/root",
		flawless: true,
		ignores: ["!.claude", "**/vendor/**"],
		namedConfigs: true,
		pnpm: true,
		roblox: false,
		test: {
			vitest: {
				extended: true,
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
	{
		name: "project/jsdoc",
		files: [GLOB_SRC],
		ignores: [GLOB_MARKDOWN_CODE],
		rules: {
			"jsdoc/require-jsdoc": [
				"warn",
				{
					contexts: [
						"TSInterfaceDeclaration",
						"TSTypeAliasDeclaration",
						"TSEnumDeclaration",
						"TSMethodSignature",
						"TSPropertySignature",
					],
					publicOnly: { ancestorsOnly: true },
					require: {
						ArrowFunctionExpression: true,
						ClassDeclaration: true,
						FunctionDeclaration: true,
						FunctionExpression: true,
						MethodDefinition: true,
					},
				},
			],
		},
	},
);
