import type { Result } from "@bedrock-rbx/ocale";

import { dirname, join } from "node:path";

import type { PluginRegistry, RegisteredStateBackend } from "../../core/plugin-registry.ts";
import type { StateBackendPromptField } from "../../core/plugin.ts";
import type { MigratePromptPort } from "../migrate-prompt-port.ts";
import type { ResolvedPortTarget, ResolvedStateTarget } from "./write-migrated-states.ts";

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
 * What the migrate command already knows about where its state should
 * live by the time the picker runs.
 */
export interface StateTargetInput {
	/**
	 * Path of the state file being migrated, which the local dump writes
	 * beside.
	 */
	readonly stateFilePath: string;
	/**
	 * `state` block the plugin that fetched the previous tool's state
	 * translated its coordinates into, if it declared a translation.
	 */
	readonly translatedTarget?: ResolvedPortTarget | undefined;
}

/** The plugin-declared **Backend** a migration is being written onto. */
interface PickedPluginTarget {
	/** The **Backend** the user picked. */
	readonly registered: RegisteredStateBackend;
	/** What the fetching plugin translated its coordinates into. */
	readonly translated: ResolvedPortTarget | undefined;
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
	let answers: Readonly<Record<string, string>> = {};
	for (const field of fields) {
		if (field.condition !== undefined && !field.condition(answers)) {
			continue;
		}

		const answer = await resolved.promptPort.promptBackendField(field);
		if (!answer.success) {
			return { err: "cancelled", success: false };
		}

		// Rebuilding rather than assigning is also what records a key like
		// `__proto__`: a computed key in a literal is an own property,
		// where the assignment form would reach the setter and vanish.
		answers = { ...answers, [field.key]: answer.data };
	}

	return { data: answers, success: true };
}

/**
 * Ask where the migrated state should live, and resolve the answers into
 * the target the writers dispatch on.
 *
 * @param resolved - Where to ask, and what the plugins declared.
 * @param input - Where the migration was read from, and the `state` block
 * the plugin that read it translated its coordinates into.
 * @returns The resolved target, or the cancellation the user chose.
 */
export async function promptForStateTargetAsync(
	resolved: StateTargetPrompts,
	input: StateTargetInput,
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
				outputDir: join(dirname(input.stateFilePath), ".bedrock", "state"),
			},
			success: true,
		};
	}

	const registered = resolved.plugins.stateBackends.get(backend.data);
	if (registered !== undefined) {
		return promptForPluginTargetAsync(resolved, {
			registered,
			translated: input.translatedTarget,
		});
	}

	return promptForGistTargetAsync(resolved);
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
 * Resolve the `state` block for the builtin gist **Backend**.
 *
 * @param resolved - Where to ask, and what the plugins declared.
 * @returns The target the writers dispatch on, or the cancellation.
 */
async function promptForGistTargetAsync(
	resolved: StateTargetPrompts,
): Promise<Result<ResolvedStateTarget, "cancelled">> {
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
 * Resolve the `state` block for a plugin-declared **Backend** by asking
 * the fields the plugin declared for it.
 *
 * A **Backend** the migration was also read through supplies its
 * translation, and its declared fields go unasked.
 *
 * @param resolved - Where to ask, and what the plugins declared.
 * @param picked - The **Backend** the user picked, and the translation the
 * fetching plugin supplied if there was one.
 * @returns The target the writers dispatch on, or the cancellation.
 */
async function promptForPluginTargetAsync(
	resolved: StateTargetPrompts,
	{ registered, translated }: PickedPluginTarget,
): Promise<Result<ResolvedStateTarget, "cancelled">> {
	if (translated?.stateConfig.backend === registered.declaration.name) {
		return { data: translated, success: true };
	}

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
