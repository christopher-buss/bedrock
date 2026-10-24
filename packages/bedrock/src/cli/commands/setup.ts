import process from "node:process";

import { LUAU_CONFIG_SOURCE } from "../../luau/config-source.ts";
import { checkLuauTypesStaleAsync } from "../../shell/check-luau-types-stale.ts";
import {
	BEDROCK_ALIAS,
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
import type { ClackPort } from "../render.ts";
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
 * `@bedrock/config` Luau types into `.bedrock/config.luau` and declares the
 * `@bedrock` alias in the project's `.luaurc`. Exits `EXIT_ERROR` without
 * writing anything when the `.luaurc` cannot take the alias or a file cannot
 * be read, and with `EXIT_ERROR` naming the path when a write fails. With
 * `--check` it writes nothing and exits `EXIT_OK` only when
 * `.bedrock/config.luau` matches the shipped types.
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
			await (rawOptions["check"] === true ? runCheckAsync(resolved) : runAsync(resolved)),
		);
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

function describeError(err: SetupLuauTypesError): string {
	switch (err.kind) {
		case "aliasConflict": {
			return `.luaurc already points the "@${err.alias}" alias at "${err.existingTarget}"; remove that alias, then rerun bedrock setup`;
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
			? `${typesPath} is out of date for this bedrock version; run bedrock setup to refresh it`
			: `${typesPath} is missing; run bedrock setup to write it`,
	);
	clack.cancel(`${COMMAND} check failed`);
	return EXIT_ERROR;
}

async function runAsync(resolved: ResolvedSetup): Promise<number> {
	const { clack } = resolved;
	const result = await setupLuauTypesAsync(resolved.setup);
	if (!result.success) {
		clack.logError(describeError(result.err));
		clack.cancel(
			result.err.kind === "fileWriteFailed"
				? `${COMMAND} failed`
				: `${COMMAND} failed; nothing was changed`,
		);
		return EXIT_ERROR;
	}

	const { luaurcPath, luaurcWritten, typesPath, typesWritten } = result.data;
	clack.logMessage(typesWritten ? `wrote ${typesPath}` : `${typesPath} is up to date`);
	clack.logMessage(
		luaurcWritten
			? `added the "@${BEDROCK_ALIAS}" alias to ${luaurcPath}`
			: `${luaurcPath} is up to date`,
	);
	clack.outro(`${COMMAND} succeeded`);
	return EXIT_OK;
}
