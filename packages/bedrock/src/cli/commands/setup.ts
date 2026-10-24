import type { Result } from "@bedrock-rbx/ocale";

import process from "node:process";

import { LUAU_SETUP_STATE_PATH, type LuauSetupOverrides } from "../../core/luau-setup-state.ts";
import { LUAU_CONFIG_SOURCE } from "../../luau/config-source.ts";
import {
	setupLuauTypesAsync,
	type SetupLuauTypesDeps,
	type SetupLuauTypesError,
} from "../../shell/setup-luau-types.ts";
import { createClackPort } from "../clack-port.ts";
import { EXIT_ERROR, EXIT_OK } from "../exit-codes.ts";
import {
	nodeMkdirAsync,
	nodeReadOptionalTextFileAsync,
	nodeWriteTextFileAsync,
} from "../fs-seams.ts";
import type { ProgDeps } from "../index.ts";
import type { ParseOptionsError } from "../parse-options.ts";
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
 * Exits `EXIT_ERROR` without writing anything when a flag has no value, the
 * `.luaurc` cannot take the alias, or a file cannot be read, and with
 * `EXIT_ERROR` naming the path when a write fails.
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
		resolved.exit(await runAsync(resolved, rawOptions));
	};
}

function resolveSetup(deps: ProgDeps): ResolvedSetup {
	return {
		clack: deps.clack ?? createClackPort(),
		exit: deps.exit ?? ((code) => process.exit(code)),
		setup: {
			bundledSource: deps.luauConfigSource ?? LUAU_CONFIG_SOURCE,
			mkdir: deps.mkdir ?? nodeMkdirAsync,
			projectRoot: deps.projectRoot ?? process.cwd(),
			readOptionalTextFile: deps.readOptionalTextFile ?? nodeReadOptionalTextFileAsync,
			writeFile: deps.writeFile ?? nodeWriteTextFileAsync,
		},
	};
}

function readFlag(
	rawOptions: Readonly<Record<string, unknown>>,
	flag: string,
): Result<string | undefined, ParseOptionsError> {
	const value = rawOptions[flag];
	if (value === undefined) {
		return { data: undefined, success: true };
	}

	if (typeof value !== "string" || value === "") {
		return { err: { flag, kind: "invalidValue" }, success: false };
	}

	return { data: value, success: true };
}

function parseOverrides(
	rawOptions: Readonly<Record<string, unknown>>,
): Result<LuauSetupOverrides, ParseOptionsError> {
	const alias = readFlag(rawOptions, "alias");
	if (!alias.success) {
		return alias;
	}

	const typesPath = readFlag(rawOptions, "types-path");
	if (!typesPath.success) {
		return typesPath;
	}

	return { data: { alias: alias.data, typesPath: typesPath.data }, success: true };
}

function describeError(err: SetupLuauTypesError): string {
	switch (err.kind) {
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
	}
}

async function runAsync(
	resolved: ResolvedSetup,
	rawOptions: Readonly<Record<string, unknown>>,
): Promise<number> {
	const { clack } = resolved;
	const overrides = parseOverrides(rawOptions);
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
