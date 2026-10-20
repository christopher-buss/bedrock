import configPnpmScopes from "@commitlint/config-pnpm-scopes";
import { RuleConfigSeverity, type RuleConfigTuple, type UserConfig } from "@commitlint/types";

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
		"scope-enum": async (ctx): Promise<RuleConfigTuple<ReadonlyArray<string>>> => {
			const projects = await configPnpmScopes.utils.getProjects(ctx);
			const aliased = projects.filter(isString).map((scope) => SCOPE_ALIASES[scope] ?? scope);
			return [RuleConfigSeverity.Error, "always", [...aliased, ...EXTRA_SCOPES]];
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
