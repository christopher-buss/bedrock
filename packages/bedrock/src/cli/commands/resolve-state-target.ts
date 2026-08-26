import type { Result } from "@bedrock-rbx/ocale";

import { dirname, join } from "node:path";

import type { PluginRegistry, RegisteredStateBackend } from "../../core/plugin-registry.ts";
import type { StateBackendPromptField } from "../../core/plugin.ts";
import type { MigratePromptPort } from "../migrate-prompt-port.ts";
import type { ResolvedStateTarget } from "./write-migrated-states.ts";

/**
 * What resolving a state target needs from the migrate command: somewhere
 * to ask, and what the loaded plugins declared.
 */
export interface StateTargetPrompts {
	/** What the loaded plugins declared. */
	readonly plugins: PluginRegistry;
	/** Port every question is asked through. */
	readonly promptPort: MigratePromptPort;
}

/**
 * Ask a plugin's declared fields in order, skipping any whose condition
 * does not hold against the answers already given.
 *
 * @param resolved - Where to ask, and what the plugins declared.
 * @param fields - The plugin's declared fields, in the order to ask them.
 * @returns The answers keyed by field, or the cancellation the user chose.
 */
export async function collectBackendAnswersAsync(
	resolved: StateTargetPrompts,
	fields: ReadonlyArray<StateBackendPromptField>,
): Promise<Result<Record<string, string>, "cancelled">> {
	const answers: Record<string, string> = {};
	for (const field of fields) {
		if (field.condition !== undefined && !field.condition(answers)) {
			continue;
		}

		const answer = await resolved.promptPort.promptBackendField(field);
		if (!answer.success) {
			return { err: "cancelled", success: false };
		}

		answers[field.key] = answer.data;
	}

	return { data: answers, success: true };
}

/**
 * Ask where the migrated state should live, and resolve the answers into
 * the target the writers dispatch on.
 *
 * @param resolved - Where to ask, and what the plugins declared.
 * @param stateFilePath - Path of the state file being migrated, which the
 * local dump writes beside.
 * @returns The resolved target, or the cancellation the user chose.
 */
export async function promptForStateTargetAsync(
	resolved: StateTargetPrompts,
	stateFilePath: string,
): Promise<Result<ResolvedStateTarget, "cancelled">> {
	const backend = await resolved.promptPort.promptStateBackend(
		migratableBackends(resolved.plugins),
	);
	if (!backend.success) {
		return { err: "cancelled", success: false };
	}

	if (backend.data === "local") {
		return {
			data: {
				backend: "local",
				outputDir: join(dirname(stateFilePath), ".bedrock", "state"),
			},
			success: true,
		};
	}

	const registered = resolved.plugins.stateBackends.get(backend.data);
	if (registered !== undefined) {
		return promptForPluginTargetAsync(resolved, registered);
	}

	const gistId = await resolved.promptPort.promptGistId();
	if (!gistId.success) {
		return { err: "cancelled", success: false };
	}

	return {
		data: { backend: "port", stateConfig: { backend: "gist", gistId: gistId.data } },
		success: true,
	};
}

/**
 * Names of the **Backend**s that can fetch the previous tool's state,
 * which is the ones whose plugin declared a migrate source.
 *
 * @param plugins - What the loaded plugins declared.
 * @returns The backend names to offer alongside reading a local file.
 */
export function fetchableBackends(plugins: PluginRegistry): ReadonlyArray<string> {
	return [...plugins.stateBackends]
		.filter(([, registered]) => registered.declaration.migrateSource !== undefined)
		.map(([name]) => name);
}

/**
 * Names of the plugin-declared **Backend**s a user can migrate onto,
 * which is the ones whose plugin declared what to ask for.
 *
 * @param plugins - What the loaded plugins declared.
 * @returns The backend names to offer alongside the builtins.
 */
function migratableBackends(plugins: PluginRegistry): ReadonlyArray<string> {
	return [...plugins.stateBackends]
		.filter(([, registered]) => registered.declaration.migratePrompts !== undefined)
		.map(([name]) => name);
}

/**
 * Resolve the `state` block for a plugin-declared **Backend** by asking
 * the fields the plugin declared for it.
 *
 * @param resolved - Where to ask, and what the plugins declared.
 * @param registered - The **Backend** the user picked.
 * @returns The target the writers dispatch on, or the cancellation.
 */
async function promptForPluginTargetAsync(
	resolved: StateTargetPrompts,
	registered: RegisteredStateBackend,
): Promise<Result<ResolvedStateTarget, "cancelled">> {
	const answers = await collectBackendAnswersAsync(
		resolved,
		registered.declaration.migratePrompts ?? [],
	);
	if (!answers.success) {
		return { err: "cancelled", success: false };
	}

	return {
		data: {
			backend: "port",
			specifier: registered.specifier,
			stateConfig: { ...answers.data, backend: registered.declaration.name },
		},
		success: true,
	};
}
