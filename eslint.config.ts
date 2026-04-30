import isentinel, { GLOB_MARKDOWN_CODE, GLOB_SRC } from "@isentinel/eslint-config";

export default isentinel(
	{
		name: "bedrock/root",
		flawless: true,
		ignores: [
			"!.claude",
			"!.claude/hooks/**",
			"**/*.example.spec.ts",
			"**/vendor/**",
			".sandcastle/worktrees/**",
			"packages/bedrock/tests/fixtures/**/*.yml",
		],
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
		typescript: {
			erasableOnly: true,
		},
	},
	{
		name: "project/config",
		files: ["*.config.{ts,js}"],
		rules: {
			"flawless/naming-convention": "off",
		},
	},
	{
		name: "project/github-required-filenames",
		files: [".github/FUNDING.{yml,yaml}"],
		rules: {
			"unicorn/filename-case": "off",
		},
	},
	{
		name: "project/src",
		files: [`packages/*/*/${GLOB_SRC}`],
		rules: {
			"better-max-params/better-max-params": ["error", { func: 2 }],
			"unicorn/no-null": "error",
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
	{
		name: "project/sandcastle",
		files: [".sandcastle/**/*.ts"],
		rules: {
			"antfu/no-top-level-await": "off",
			"no-console": "off",
		},
	},
);
