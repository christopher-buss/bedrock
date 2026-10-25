import process from "node:process";

import { LUAU_SETUP_STATE_PATH, LUAU_TYPES_FILE_NAME } from "../../core/luau-setup-state.ts";
import { checkLuauTypesStaleAsync } from "../../shell/check-luau-types-stale.ts";
import {
	setupLuauTypesAsync,
	type SetupLuauTypesDeps,
	type SetupLuauTypesError,
} from "../../shell/setup-luau-types.ts";
import { createClackPort } from "../clack-port.ts";
import { EXIT_ERROR, EXIT_OK } from "../exit-codes.ts";
import { nodeMkdirAsync, nodeWriteTextFileAsync } from "../fs-seams.ts";
import type { ProgDeps } from "../index.ts";
import { describeStaleLuauTypes, resolveLuauTypesInputs } from "../luau-types-check.ts";
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
 * and declares the `@bedrock` alias (or `--alias`) in the project's `.luaurc`.
 * Exits `EXIT_ERROR` without writing anything when a flag is unknown or has
 * no value, `--types-path` is absolute or not a `config.luau` file, the
 * `.luaurc` cannot take the alias, or a file cannot be read, and with
 * `EXIT_ERROR` naming the path when a write fails. With `--check` it writes
 * nothing and exits `EXIT_OK` only when the types at the path a prior run
 * recorded match the shipped ones.
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
			writeFile: deps.writeFile ?? nodeWriteTextFileAsync,
		},
	};
}

function describeError(err: SetupLuauTypesError): string {
	switch (err.kind) {
		case "absoluteTypesPath": {
			return `types path "${err.typesPath}" must be relative to the project root`;
		}
		case "aliasConflict": {
			return `.luaurc already points the "@${err.alias}" alias at "${err.existingTarget}"; rerun bedrock setup with --alias <name> to use another alias, or remove "@${err.alias}" from .luaurc`;
		}
		case "fileReadFailed": {
			return `cannot read ${err.path}: ${describeUnknown(err.cause)}`;
		}
		case "fileWriteFailed": {
			return `cannot write ${err.path}: ${describeUnknown(err.cause)}`;
		}
		case "malformedLuaurc": {
			return `.luaurc cannot be updated because ${err.message}`;
		}
		case "malformedSetupState": {
			return `${LUAU_SETUP_STATE_PATH} cannot be read because ${err.message}; delete it, then rerun bedrock setup`;
		}
		case "typesFileNotConfig": {
			return `types path "${err.typesPath}" must name a file called ${LUAU_TYPES_FILE_NAME}`;
		}
	}
}

async function runCheckAsync(resolved: ResolvedSetup): Promise<number> {
	const { clack } = resolved;
	const result = await checkLuauTypesStaleAsync(resolved.setup);
	if (!result.success) {
		clack.logError(describeError(result.err));
		clack.cancel(`${COMMAND} check failed`);
		return EXIT_ERROR;
	}

	const { status, typesPath } = result.data;
	if (status === "fresh") {
		clack.logMessage(`${typesPath} is up to date`);
		clack.outro(`${COMMAND} check passed`);
		return EXIT_OK;
	}

	clack.logError(
		status === "stale"
			? describeStaleLuauTypes(typesPath)
			: `${typesPath} is missing; run bedrock setup to write it`,
	);
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

	const { alias, luaurcPath, luaurcWritten, typesPath, typesWritten } = result.data;
	clack.logMessage(typesWritten ? `wrote ${typesPath}` : `${typesPath} is up to date`);
	clack.logMessage(
		luaurcWritten
			? `added the "@${alias}" alias to ${luaurcPath}`
			: `${luaurcPath} is up to date`,
	);
	clack.outro(`${COMMAND} succeeded`);
	return EXIT_OK;
}
