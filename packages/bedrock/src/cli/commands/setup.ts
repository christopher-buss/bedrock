import { basename } from "node:path";
import process from "node:process";

import { LUAU_SETUP_STATE_PATH, LUAU_TYPES_FILE_NAME } from "../../core/luau-setup-state.ts";
import {
	checkLuauTypesStaleAsync,
	type LuauTypesStaleness,
} from "../../shell/check-luau-types-stale.ts";
import type { LuauConfigAliasError } from "../../shell/plan-luau-config-alias.ts";
import {
	setupLuauTypesAsync,
	type SetupLuauTypesDeps,
	type SetupLuauTypesError,
} from "../../shell/setup-luau-types.ts";
import { createClackPort } from "../clack-port.ts";
import { EXIT_ERROR, EXIT_OK } from "../exit-codes.ts";
import { nodeMkdirAsync, nodeRenameFileAsync, nodeWriteTextFileAsync } from "../fs-seams.ts";
import type { ProgDeps } from "../index.ts";
import {
	describeLuauAliasIssue,
	describeStaleLuauTypes,
	resolveLuauTypesInputs,
} from "../luau-types-check.ts";
import { parseSetupOptions } from "../parse-setup-options.ts";
import { type ClackPort, renderParseError } from "../render.ts";
import { describeUnknown } from "./describe-unknown.ts";

const COMMAND = "setup";

/** The command's dependency slots, each resolved to a real default. */
interface ResolvedSetup {
	readonly clack: ClackPort;
	readonly exit: (code: number) => void;
	readonly setup: SetupLuauTypesDeps;
}

/**
 * Build the sade action for `bedrock setup`. Writes the bundled
 * `@bedrock/config` Luau types into `.bedrock/config.luau` (or `--types-path`)
 * and declares the `@bedrock` alias (or `--alias`) in the project's
 * `.config.luau` when it has one, else in its `.luaurc`. Exits `EXIT_ERROR`
 * without writing anything when a flag is unknown or has no value,
 * `--types-path` is absolute, outside the project, or not a `config.luau`
 * file, the project holds both config files, the config file cannot take the
 * alias (printing the entry to add when `.config.luau` is not a literal
 * table), or a file cannot be read, and with `EXIT_ERROR` naming the path when
 * a write fails. With `--check` it writes nothing and exits `EXIT_OK` only
 * when the types at the path a prior run recorded match the shipped ones.
 *
 * @param deps - Dependency overrides; missing slots are default-constructed
 *   from real implementations.
 * @returns A sade action that returns once `deps.exit` was invoked.
 */
export function setupCommand(
	deps: ProgDeps,
): (rawOptions?: Readonly<Record<string, unknown>>) => Promise<void> {
	const resolved = resolveSetup(deps);
	return async (rawOptions = {}) => {
		resolved.exit(
			await (rawOptions["check"] === true
				? runCheckAsync(resolved)
				: runAsync(resolved, rawOptions)),
		);
	};
}

function resolveSetup(deps: ProgDeps): ResolvedSetup {
	return {
		clack: deps.clack ?? createClackPort(),
		exit: deps.exit ?? ((code) => process.exit(code)),
		setup: {
			...resolveLuauTypesInputs(deps),
			mkdir: deps.mkdir ?? nodeMkdirAsync,
			rename: deps.rename ?? nodeRenameFileAsync,
			writeFile: deps.writeFile ?? nodeWriteTextFileAsync,
		},
	};
}

function describeConfigError(err: LuauConfigAliasError): string {
	switch (err.kind) {
		case "aliasConflict": {
			const file = basename(err.configPath);
			return `${file} already points the "@${err.alias}" alias at "${err.existingTarget}"; rerun bedrock setup with --alias <name> to use another alias, or remove "@${err.alias}" from ${file}`;
		}
		case "configLuauEditFailed": {
			return `cannot edit .config.luau: ${err.message}`;
		}
		case "conflictingLuauConfigs": {
			return `${err.luaurcPath} and ${err.configLuauPath} both exist, and Luau accepts only one config file per directory; remove one, then rerun bedrock setup`;
		}
		case "luauRuntimeMissing": {
			return `cannot edit .config.luau without the lute runtime; ${err.hint}`;
		}
		case "malformedLuaurc": {
			return `.luaurc cannot be updated because ${err.message}`;
		}
		case "uneditableConfigLuau": {
			return `${err.configPath} cannot be updated because ${err.reason}; add the alias under luau.aliases in the table it returns, then rerun bedrock setup:\n${err.snippet}`;
		}
	}
}

function describeError(err: SetupLuauTypesError): string {
	switch (err.kind) {
		case "absoluteTypesPath": {
			return `types path "${err.typesPath}" must be relative to the project root`;
		}
		case "aliasConflict":
		case "configLuauEditFailed":
		case "conflictingLuauConfigs":
		case "luauRuntimeMissing":
		case "malformedLuaurc":
		case "uneditableConfigLuau": {
			return describeConfigError(err);
		}
		case "fileReadFailed": {
			return `cannot read ${err.path}: ${describeUnknown(err.cause)}`;
		}
		case "fileWriteFailed": {
			return `cannot write ${err.path}: ${describeUnknown(err.cause)}`;
		}
		case "malformedSetupState": {
			return `${LUAU_SETUP_STATE_PATH} cannot be read because ${err.message}; delete it, then rerun bedrock setup`;
		}
		case "typesFileNotConfig": {
			return `types path "${err.typesPath}" must name a file called ${LUAU_TYPES_FILE_NAME}`;
		}
		case "typesPathOutsideProject": {
			return `types path "${err.typesPath}" must stay inside the project root`;
		}
	}
}

function describeCheckProblems({
	aliasIssue,
	status,
	typesPath,
}: LuauTypesStaleness): Array<string> {
	const typesProblems = {
		fresh: [],
		missing: [`${typesPath} is missing; run bedrock setup to write it`],
		stale: [describeStaleLuauTypes(typesPath)],
	}[status];
	return aliasIssue === undefined
		? typesProblems
		: [...typesProblems, describeLuauAliasIssue(aliasIssue)];
}

async function runCheckAsync(resolved: ResolvedSetup): Promise<number> {
	const { clack } = resolved;
	const result = await checkLuauTypesStaleAsync(resolved.setup);
	if (!result.success) {
		clack.logError(describeError(result.err));
		clack.cancel(`${COMMAND} check failed`);
		return EXIT_ERROR;
	}

	const problems = describeCheckProblems(result.data);
	if (problems.length === 0) {
		clack.logMessage(`${result.data.typesPath} is up to date`);
		clack.outro(`${COMMAND} check passed`);
		return EXIT_OK;
	}

	for (const problem of problems) {
		clack.logError(problem);
	}

	clack.cancel(`${COMMAND} check failed`);
	return EXIT_ERROR;
}

async function runAsync(
	resolved: ResolvedSetup,
	rawOptions: Readonly<Record<string, unknown>>,
): Promise<number> {
	const { clack } = resolved;
	const overrides = parseSetupOptions(rawOptions);
	if (!overrides.success) {
		renderParseError(overrides.err, clack);
		clack.cancel(`${COMMAND} failed; nothing was changed`);
		return EXIT_ERROR;
	}

	const result = await setupLuauTypesAsync({ ...resolved.setup, overrides: overrides.data });
	if (!result.success) {
		clack.logError(describeError(result.err));
		clack.cancel(
			result.err.kind === "fileWriteFailed"
				? `${COMMAND} failed`
				: `${COMMAND} failed; nothing was changed`,
		);
		return EXIT_ERROR;
	}

	const { alias, configPath, configWritten, typesPath, typesWritten } = result.data;
	clack.logMessage(typesWritten ? `wrote ${typesPath}` : `${typesPath} is up to date`);
	clack.logMessage(
		configWritten
			? `added the "@${alias}" alias to ${configPath}`
			: `${configPath} is up to date`,
	);
	clack.outro(`${COMMAND} succeeded`);
	return EXIT_OK;
}
