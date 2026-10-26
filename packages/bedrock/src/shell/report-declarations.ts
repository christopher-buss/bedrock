import {
	buildDeclarationReports,
	collectDeclarations,
	type DeclarationReport,
} from "../core/declaration-report.ts";
import type { Config } from "../core/schema.ts";
import type { BedrockState } from "../core/state.ts";
import type { StatePort } from "../ports/state-port.ts";

/**
 * Observe every environment, using the active snapshot already read or
 * persisted.
 * @param inputs - Authored config, the per-environment reader and a known persisted snapshot.
 * @returns Status of every temporary declaration; unreadable state stays unknown.
 */
export async function reportDeclarationsAsync({
	config,
	known,
	read,
}: {
	readonly config: Config;
	readonly known: { readonly environment: string; readonly state: BedrockState | undefined };
	readonly read: StatePort["read"];
}): Promise<ReadonlyArray<DeclarationReport>> {
	const declarations = collectDeclarations(config);
	if (declarations.length === 0) {
		return [];
	}

	const states = new Map<string, BedrockState | undefined>();
	const unknownEnvironments: Array<string> = [];
	for (const environment of Object.keys(config.environments)) {
		if (environment === known.environment) {
			states.set(environment, known.state);
			continue;
		}

		try {
			const result = await read(environment);
			if (result.success) {
				states.set(environment, result.data.state);
			} else {
				unknownEnvironments.push(environment);
			}
		} catch {
			unknownEnvironments.push(environment);
		}
	}

	return buildDeclarationReports(declarations, { states, unknownEnvironments });
}
