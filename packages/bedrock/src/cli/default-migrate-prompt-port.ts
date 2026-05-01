import {
	isCancel as defaultIsCancel,
	path as defaultPath,
	select as defaultSelect,
	text as defaultText,
	type PathOptions,
	type SelectOptions,
	type TextOptions,
} from "@clack/prompts";

import type {
	MigrateConfigFormat,
	MigratePromptPort,
	MigratePromptResult,
	MigrateStateBackend,
} from "./migrate-prompt-port.ts";
import type { MigrationSource } from "./parse-migrate-options.ts";

/**
 * Test seam for {@link createDefaultMigratePromptPort}. Production callers
 * omit `helpers` and the port delegates straight to `@clack/prompts`;
 * tests substitute scripted, non-generic stand-ins so each prompt method
 * can be exercised without spawning a real terminal.
 *
 * Slot signatures use clack's own types pinned to `string`-valued options
 * so a `vi.fn` instance is assignable: vitest cannot construct a `Mock`
 * that satisfies a polymorphic `<Value>(...)` signature, but it can
 * satisfy this concrete shape.
 */
export interface MigratePromptClackHelpers {
	/** Cancel predicate; defaults to `@clack/prompts`'s `isCancel`. */
	readonly isCancel: (value: unknown) => value is symbol;
	/**
	 * Path-prompt fn with filesystem tab-completion; defaults to
	 * `@clack/prompts`'s `path`.
	 */
	readonly path: (options: PathOptions) => Promise<string | symbol>;
	/** Select-prompt fn; defaults to `@clack/prompts`'s `select`. */
	readonly select: (options: SelectOptions<string>) => Promise<string | symbol>;
	/** Text-prompt fn; defaults to `@clack/prompts`'s `text`. */
	readonly text: (options: TextOptions) => Promise<string | symbol>;
}

const FORMAT_OPTIONS: ReadonlyArray<{ hint?: string; label: string; value: MigrateConfigFormat }> =
	[
		{ hint: "recommended", label: "TypeScript", value: "typescript" },
		{ label: "YAML", value: "yaml" },
	];

const BACKEND_OPTIONS: ReadonlyArray<{ hint?: string; label: string; value: MigrateStateBackend }> =
	[
		{ label: "GitHub Gist", value: "gist" },
		{
			hint: "writes ./bedrock-state/<env>.json next to bedrock.config",
			label: "Local files",
			value: "local",
		},
	];

const SOURCE_LABELS: Record<MigrationSource, string> = {
	mantle: "Mantle",
};

const defaultHelpers: MigratePromptClackHelpers = {
	isCancel: defaultIsCancel,
	path: defaultPath,
	select: defaultSelect,
	text: defaultText,
};

interface FromSelectInputs<T extends string> {
	readonly initialValue?: T;
	readonly message: string;
	readonly options: ReadonlyArray<{ hint?: string; label: string; value: T }>;
}

/**
 * Construct a `MigratePromptPort` whose methods delegate to
 * `@clack/prompts`. Each prompt translates clack's cancel sentinel into
 * a typed `Err({ kind: "cancelled" })` so the migrate command branches
 * on `Result` like every other shell call.
 *
 * @param helpers - Test-only seam for swapping the three clack
 *   primitives. Production callers omit this argument.
 * @returns A live `MigratePromptPort` ready to drive interactively.
 */
export function createDefaultMigratePromptPort(
	helpers: MigratePromptClackHelpers = defaultHelpers,
): MigratePromptPort {
	return {
		promptConfigFormat: async () => promptConfigFormatFrom(helpers),
		promptGistId: async () => promptGistIdFrom(helpers),
		promptMigrationSource: async (sources) => selectMigrationSource(helpers, sources),
		promptPrimaryEnvironment: async (environments) =>
			selectPrimaryEnvironment(helpers, environments),
		promptStateBackend: async () => promptStateBackendFrom(helpers),
		promptStateFilePath: async () => promptStateFilePathFrom(helpers),
	};
}

async function fromSelect<T extends string>(
	helpers: MigratePromptClackHelpers,
	inputs: FromSelectInputs<T>,
): Promise<MigratePromptResult<T>> {
	const result = await helpers.select({
		message: inputs.message,
		options: inputs.options.map((option) => {
			return {
				...(option.hint === undefined ? {} : { hint: option.hint }),
				label: option.label,
				value: option.value,
			};
		}),
		...(inputs.initialValue === undefined ? {} : { initialValue: inputs.initialValue }),
	});
	if (helpers.isCancel(result)) {
		return { err: { kind: "cancelled" }, success: false };
	}

	return { data: result as T, success: true };
}

async function selectMigrationSource(
	helpers: MigratePromptClackHelpers,
	sources: readonly [MigrationSource, ...ReadonlyArray<MigrationSource>],
): Promise<MigratePromptResult<MigrationSource>> {
	return fromSelect<MigrationSource>(helpers, {
		initialValue: sources[0],
		message: "Migrate from?",
		options: sources.map((source) => ({ label: SOURCE_LABELS[source], value: source })),
	});
}

async function promptConfigFormatFrom(
	helpers: MigratePromptClackHelpers,
): Promise<MigratePromptResult<MigrateConfigFormat>> {
	return fromSelect(helpers, {
		initialValue: "typescript",
		message: "Output config format?",
		options: FORMAT_OPTIONS,
	});
}

function validateNonEmpty(value: string | undefined): string | undefined {
	if (value === undefined || value.trim() === "") {
		return "Required";
	}

	return undefined;
}

async function fromText(
	helpers: MigratePromptClackHelpers,
	options: TextOptions,
): Promise<MigratePromptResult<string>> {
	const result = await helpers.text(options);
	if (helpers.isCancel(result)) {
		return { err: { kind: "cancelled" }, success: false };
	}

	return { data: result, success: true };
}

async function promptGistIdFrom(
	helpers: MigratePromptClackHelpers,
): Promise<MigratePromptResult<string>> {
	return fromText(helpers, {
		message: "Gist ID for state storage?",
		placeholder: "abc123",
		validate: validateNonEmpty,
	});
}

async function selectPrimaryEnvironment(
	helpers: MigratePromptClackHelpers,
	environments: ReadonlyArray<string>,
): Promise<MigratePromptResult<string>> {
	return fromSelect(helpers, {
		message: "Primary environment?",
		options: environments.map((name) => ({ label: name, value: name })),
	});
}

async function promptStateBackendFrom(
	helpers: MigratePromptClackHelpers,
): Promise<MigratePromptResult<MigrateStateBackend>> {
	return fromSelect(helpers, {
		initialValue: "gist",
		message: "State backend?",
		options: BACKEND_OPTIONS,
	});
}

async function fromPath(
	helpers: MigratePromptClackHelpers,
	options: PathOptions,
): Promise<MigratePromptResult<string>> {
	const result = await helpers.path(options);
	if (helpers.isCancel(result)) {
		return { err: { kind: "cancelled" }, success: false };
	}

	return { data: result, success: true };
}

async function promptStateFilePathFrom(
	helpers: MigratePromptClackHelpers,
): Promise<MigratePromptResult<string>> {
	return fromPath(helpers, {
		initialValue: ".mantle-state.yml",
		message: "Path to the Mantle state file?",
		validate: validateNonEmpty,
	});
}
