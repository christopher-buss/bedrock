import configPnpmScopes from "@commitlint/config-pnpm-scopes";
import { RuleConfigSeverity, type UserConfig } from "@commitlint/types";

const SCOPE_ALIASES: Record<string, string> = {
	"open-cloud": "ocale",
	"typescript-config": "tsconfig",
	"vite-config": "vite",
};

export default {
	extends: ["@commitlint/config-conventional", "@commitlint/config-pnpm-scopes"],
	rules: {
		"header-max-length": [RuleConfigSeverity.Error, "always", 72],
		"scope-enum": async (ctx) => {
			const [level, applicable, scopes] = (await configPnpmScopes.rules["scope-enum"](
				ctx,
			)) as [RuleConfigSeverity, "always", Array<string>];
			const aliased = scopes.map((scope) => SCOPE_ALIASES[scope] ?? scope);
			return [level, applicable, aliased];
		},
		"subject-case": [RuleConfigSeverity.Error, "always", ["lower-case"]],
		"type-enum": [
			RuleConfigSeverity.Error,
			"always",
			[
				"build",
				"ci",
				"chore",
				"docs",
				"feat",
				"fix",
				"perf",
				"refactor",
				"revert",
				"style",
				"test",
			],
		],
	},
} satisfies UserConfig;
