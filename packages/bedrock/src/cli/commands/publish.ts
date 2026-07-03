import { publish as defaultPublish } from "../../shell/deploy.ts";
import type { ProgDeps } from "../index.ts";
import { createReconcileCommand } from "./reconcile-command.ts";

/**
 * Build the sade action for `bedrock publish`. Uploads the on-disk artifact for
 * every place under a pending-rebuild marker in each `--env` (deduplicated by
 * file hash, clearing the marker per republished place) without minting, codegen, or
 * building, dispatching a `.bedrock/publish.ts` override when one is discovered.
 * The aggregated exit code is `EXIT_OK` only when every env succeeded.
 * @param deps - Dependency overrides; missing slots are default-constructed
 *   from real implementations.
 * @returns An async sade action that returns once `deps.exit` was invoked.
 */
export function publishCommand(
	deps: ProgDeps,
): (rawOptions: Record<string, unknown>) => Promise<void> {
	return createReconcileCommand(deps, {
		command: "publish",
		resolveRun: (progDeps) => progDeps.publish ?? defaultPublish,
	});
}
