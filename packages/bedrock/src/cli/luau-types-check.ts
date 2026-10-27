import process from "node:process";

import { createLuteConfigLuauEditor } from "../adapters/lute-config-luau-editor.ts";
import { LUAU_CONFIG_SOURCE } from "../luau/config-source.ts";
import {
	checkLuauTypesStaleAsync,
	type CheckLuauTypesStaleDeps,
	type LuauAliasIssue,
} from "../shell/check-luau-types-stale.ts";
import { nodeReadOptionalTextFileAsync } from "./fs-seams.ts";
import type { ProgDeps } from "./index.ts";

const SKIP_VARIABLE = "BEDROCK_SKIP_TYPES_CHECK";

/**
 * Resolve the Luau types inputs every command shares, falling back to the
 * shipped source, the `lute`-backed `.config.luau` editor, the working
 * directory, and the real filesystem.
 *
 * @param deps - Dependency overrides.
 * @returns The bundled source, editor, project root, and read seam.
 */
export function resolveLuauTypesInputs(deps: ProgDeps): CheckLuauTypesStaleDeps {
	return {
		bundledSource: deps.luauConfigSource ?? LUAU_CONFIG_SOURCE,
		configLuauEditor: deps.configLuauEditor ?? createLuteConfigLuauEditor(),
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
 * Describe a `.config.luau` that does not point the setup alias at the Luau
 * types.
 *
 * @param issue - What is wrong with the alias.
 * @returns The message naming the file, the alias, and how to fix it.
 */
export function describeLuauAliasIssue({ alias, configPath, kind }: LuauAliasIssue): string {
	return kind === "aliasMissing"
		? `${configPath} does not declare the "@${alias}" alias; run bedrock setup to add it`
		: `${configPath} points the "@${alias}" alias away from the Luau types; run bedrock setup to fix it`;
}

/**
 * Wrap a command action so it first warns on stderr when the Luau types
 * `bedrock setup` wrote differ from the ones this bedrock version ships, or
 * the project's `.config.luau` does not point the alias at them. Absent or
 * unreadable types, or an unreadable setup state, produce no warning, and
 * setting
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

	const result = await checkLuauTypesStaleAsync(resolveLuauTypesInputs(deps));
	if (!result.success) {
		return;
	}

	const warn = deps.warn ?? writeWarning;
	const { aliasIssue, status, typesPath } = result.data;
	if (status === "stale") {
		warn(describeStaleLuauTypes(typesPath));
	}

	if (aliasIssue !== undefined) {
		warn(describeLuauAliasIssue(aliasIssue));
	}
}
