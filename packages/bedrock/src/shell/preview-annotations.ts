import type { DeclarationReport } from "../core/declaration-report.ts";
import type { Config } from "../core/schema.ts";
import type { BedrockState } from "../core/state.ts";
import type { StateLockError, StateLockHolding, StateLockPort } from "../ports/state-lock-port.ts";
import type { StatePort } from "../ports/state-port.ts";
import { reportDeclarationsAsync } from "./report-declarations.ts";

interface ConcurrentHold {
	/**
	 * Who holds the Environment, absent when nobody could say or nobody does.
	 */
	readonly concurrentHold?: StateLockHolding | undefined;
	/** Why the lock store could not say who holds the Environment. */
	readonly holdUnknown?: StateLockError | undefined;
}

interface AnnotationDependencies {
	/** Config before selecting an Environment. */
	readonly authoredConfig: Config;
	/** Read each Environment for declaration reports. */
	readonly readEnvironmentState: StatePort["read"];
	/** Backend exclusion, absent when unsupported. */
	readonly stateLockPort: StateLockPort | undefined;
}

/**
 * Report concurrent holds and temporary declarations without taking a hold.
 * @param dependencies - Config and backend readers.
 * @param known - The already-read Environment snapshot.
 * @returns Read-only preview annotations.
 * @since unreleased
 */
export async function readPreviewAnnotationsAsync(
	dependencies: AnnotationDependencies,
	known: { readonly environment: string; readonly state: BedrockState | undefined },
): Promise<ConcurrentHold & { readonly declarationReports: ReadonlyArray<DeclarationReport> }> {
	return {
		...(await readHoldAsync(known.environment, dependencies.stateLockPort)),
		declarationReports: await reportDeclarationsAsync({
			config: dependencies.authoredConfig,
			known,
			read: dependencies.readEnvironmentState,
		}),
	};
}

async function readHoldAsync(
	environment: string,
	stateLockPort: StateLockPort | undefined,
): Promise<ConcurrentHold> {
	if (stateLockPort === undefined) {
		return {};
	}

	const held = await stateLockPort.inspect(environment);
	return held.success ? { concurrentHold: held.data } : { holdUnknown: held.err };
}
