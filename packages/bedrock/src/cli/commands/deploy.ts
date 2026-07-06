import { deploy as defaultDeploy } from "../../shell/deploy.ts";
import type { ProgDeps } from "../index.ts";
import { createReconcileCommand } from "./reconcile-command.ts";

/**
 * Build the sade action for `bedrock deploy`. Reconciles every `--env` against
 * the configured environment, dispatching a `.bedrock/deploy.ts` override when
 * one is discovered. On the shell path a `.bedrock/build.ts` override is also
 * discovered and, when present, injected as the fused deploy's build step so
 * the pipeline spawns it between its provision and publish stages. The
 * aggregated exit code is `EXIT_OK` only when every env succeeded. See
 * {@link createReconcileCommand} for the shared scaffolding.
 * @param deps - Dependency overrides; missing slots are default-constructed
 *   from real implementations.
 * @returns An async sade action that returns once `deps.exit` was invoked.
 */
export function deployCommand(
	deps: ProgDeps,
): (rawOptions: Record<string, unknown>) => Promise<void> {
	return createReconcileCommand(deps, {
		command: "deploy",
		fusedBuild: true,
		resolveRun: (progDeps) => progDeps.deploy ?? defaultDeploy,
	});
}
