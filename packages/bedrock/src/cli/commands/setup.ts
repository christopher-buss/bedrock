import process from "node:process";

import type { LuaurcAliasError } from "../../core/luaurc.ts";
import { LUAU_CONFIG_SOURCE } from "../../luau/config-source.ts";
import {
	setupLuauTypesAsync as defaultSetupLuauTypes,
	type SetupLuauTypesDeps,
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
 * writing anything when the `.luaurc` cannot take the alias.
 *
 * @param deps - Dependency overrides; missing slots are default-constructed
 *   from real implementations.
 * @returns A sade action that returns once `deps.exit` was invoked.
 */
export function setupCommand(deps: ProgDeps): () => Promise<void> {
	const resolved = resolveSetup(deps);
	return async () => {
		resolved.exit(await runAsync(resolved));
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

function describeError(err: LuaurcAliasError): string {
	if (err.kind === "aliasConflict") {
		return `.luaurc already points the "@${err.alias}" alias at "${err.existingTarget}"; remove that alias, then rerun bedrock setup`;
	}

	return `.luaurc cannot be updated because ${err.message}`;
}

async function runAsync(resolved: ResolvedSetup): Promise<number> {
	const { clack } = resolved;
	const result = await defaultSetupLuauTypes(resolved.setup);
	if (!result.success) {
		clack.logError(describeError(result.err));
		clack.cancel(`${COMMAND} failed; nothing was changed`);
		return EXIT_ERROR;
	}

	const { luaurcPath, luaurcWritten, typesPath, typesWritten } = result.data;
	clack.logMessage(typesWritten ? `wrote ${typesPath}` : `${typesPath} is up to date`);
	clack.logMessage(
		luaurcWritten
			? `added the "@bedrock" alias to ${luaurcPath}`
			: `${luaurcPath} is up to date`,
	);
	clack.outro(`${COMMAND} succeeded`);
	return EXIT_OK;
}
