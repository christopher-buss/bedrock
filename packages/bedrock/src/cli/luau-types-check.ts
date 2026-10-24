import process from "node:process";

import { LUAU_CONFIG_SOURCE } from "../luau/config-source.ts";
import {
	checkLuauTypesStaleAsync,
	type CheckLuauTypesStaleDeps,
} from "../shell/check-luau-types-stale.ts";
import { TYPES_FILE } from "../shell/setup-luau-types.ts";
import { nodeReadOptionalTextFileAsync } from "./fs-seams.ts";
import type { ProgDeps } from "./index.ts";

const SKIP_VARIABLE = "BEDROCK_SKIP_TYPES_CHECK";

/**
 * Resolve the Luau types inputs every command shares, falling back to the
 * shipped source, the working directory, and the real filesystem.
 *
 * @param deps - Dependency overrides.
 * @returns The bundled source, project root, and read seam.
 */
export function resolveLuauTypesInputs(
	deps: ProgDeps,
): Pick<CheckLuauTypesStaleDeps, "bundledSource" | "projectRoot" | "readOptionalTextFile"> {
	return {
		bundledSource: deps.luauConfigSource ?? LUAU_CONFIG_SOURCE,
		projectRoot: deps.projectRoot ?? process.cwd(),
		readOptionalTextFile: deps.readOptionalTextFile ?? nodeReadOptionalTextFileAsync,
	};
}

/**
 * Describe Luau types on disk that differ from the ones this bedrock version
 * ships.
 *
 * @param typesPath - Path of the stale Luau types file.
 * @returns The message naming the file and how to refresh it.
 */
export function describeStaleLuauTypes(typesPath: string): string {
	return `${typesPath} is out of date for this bedrock version; run bedrock setup to refresh it`;
}

/**
 * Wrap a command action so it first warns on stderr when the project's
 * `.bedrock/config.luau` differs from the Luau types this bedrock version
 * ships. Absent or unreadable types produce no warning, and setting
 * `BEDROCK_SKIP_TYPES_CHECK=1` skips the check. The action always runs and
 * no file is written.
 *
 * @template A - The action's argument list.
 * @param deps - Dependency overrides; missing slots resolve to real defaults.
 * @param action - The command action to run after the check.
 * @returns The action, preceded by the check.
 */
export function withLuauTypesCheck<A extends ReadonlyArray<unknown>>(
	deps: ProgDeps,
	action: (...args: A) => Promise<void>,
): (...args: A) => Promise<void> {
	return async (...args) => {
		await warnIfStaleAsync(deps);
		await action(...args);
	};
}

function writeWarning(message: string): void {
	process.stderr.write(`warning: ${message}\n`);
}

async function warnIfStaleAsync(deps: ProgDeps): Promise<void> {
	if (process.env[SKIP_VARIABLE] === "1") {
		return;
	}

	const result = await checkLuauTypesStaleAsync({
		...resolveLuauTypesInputs(deps),
		typesFile: TYPES_FILE,
	});
	if (result.success && result.data.status === "stale") {
		(deps.warn ?? writeWarning)(describeStaleLuauTypes(result.data.typesPath));
	}
}
