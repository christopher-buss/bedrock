import process from "node:process";

import { LUAU_CONFIG_SOURCE } from "../luau/config-source.ts";
import { checkLuauTypesStaleAsync } from "../shell/check-luau-types-stale.ts";
import { nodeReadOptionalTextFileAsync } from "./fs-seams.ts";
import type { ProgDeps } from "./index.ts";

const SKIP_VARIABLE = "BEDROCK_SKIP_TYPES_CHECK";

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

	try {
		const { status, typesPath } = await checkLuauTypesStaleAsync({
			bundledSource: deps.luauConfigSource ?? LUAU_CONFIG_SOURCE,
			projectRoot: deps.projectRoot ?? process.cwd(),
			readOptionalTextFile: deps.readOptionalTextFile ?? nodeReadOptionalTextFileAsync,
		});
		if (status === "stale") {
			(deps.warn ?? writeWarning)(
				`${typesPath} is out of date for this bedrock version; run bedrock setup to refresh it`,
			);
		}
	} catch {
		// An unreadable types file must not stop the command.
	}
}
