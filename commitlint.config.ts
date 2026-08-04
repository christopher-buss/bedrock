import configPnpmScopes from "@commitlint/config-pnpm-scopes";
import { RuleConfigSeverity, type UserConfig } from "@commitlint/types";

const SCOPE_ALIASES: Record<string, string> = {
	"open-cloud": "ocale",
	"typescript-config": "tsconfig",
	"vite-config": "vite",
};

const EXTRA_SCOPES = ["deps"];

function isString(value: unknown): value is string {
	return typeof value === "string";
}

export default {
	extends: ["@commitlint/config-conventional", "@commitlint/config-pnpm-scopes"],
	rules: {
		"header-max-length": [RuleConfigSeverity.Error, "always", 72],
		"scope-enum": async (ctx) => {
			// `@commitlint/config-pnpm-scopes` types this rule's result as the
			// broad `RuleConfigTuple`, so the workspace scope list it actually
			// returns has to be recovered by narrowing.
			const rule: ReadonlyArray<unknown> = await configPnpmScopes.rules["scope-enum"](ctx);
			const [level, applicable, scopes] = rule;
			const declared = Array.isArray(scopes) ? scopes.filter(isString) : [];
			const aliased = declared.map((scope) => SCOPE_ALIASES[scope] ?? scope);
			return [level, applicable, [...aliased, ...EXTRA_SCOPES]];
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
