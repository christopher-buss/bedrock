import { provision as defaultProvision } from "../../shell/deploy.ts";
import type { ProgDeps } from "../index.ts";
import { createReconcileCommand } from "./reconcile-command.ts";

/**
 * Build the sade action for `bedrock provision`. Runs the asset stage plus
 * codegen for every `--env` (minting IDs and setting the pending-rebuild
 * marker) without building or publishing any place, dispatching a
 * `.bedrock/provision.ts` override when one is discovered. The aggregated exit
 * code is `EXIT_OK` only when every env succeeded.
 * @param deps - Dependency overrides; missing slots are default-constructed
 *   from real implementations.
 * @returns An async sade action that returns once `deps.exit` was invoked.
 */
export function provisionCommand(
	deps: ProgDeps,
): (rawOptions: Record<string, unknown>) => Promise<void> {
	return createReconcileCommand(deps, {
		command: "provision",
		resolveRun: (progDeps) => progDeps.provision ?? defaultProvision,
	});
}
