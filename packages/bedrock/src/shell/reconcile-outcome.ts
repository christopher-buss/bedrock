import type { Result } from "@bedrock-rbx/ocale";

import type { DeferredCreate } from "../core/capacity-check.ts";
import type { BedrockState } from "../core/state.ts";
import type { DeployError } from "./deploy.ts";

/**
 * What a reconcile returned, plus the badge creates Roblox refused for cost
 * during it. The deferred creates ride beside the snapshot, never inside it,
 * so they never reach **State**.
 */
export type ReconcileOutcome = Result<BedrockState, DeployError> & {
	readonly deferred?: ReadonlyArray<DeferredCreate> | undefined;
};

/**
 * Carry a runner's Deferred creates over to the outcome a stage builds from
 * its result, leaving an outcome with none untouched.
 *
 * @param outcome - What the stage returns.
 * @param deferred - The creates the runner deferred, if it reported any.
 * @returns The outcome, beside the deferred creates when there are any.
 */
export function withDeferred(
	outcome: Result<BedrockState, DeployError>,
	deferred: ReadonlyArray<DeferredCreate> | undefined,
): ReconcileOutcome {
	return deferred === undefined ? outcome : { ...outcome, deferred };
}
