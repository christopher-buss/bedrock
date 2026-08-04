import type { Result } from "@bedrock-rbx/ocale";

import { describe, expect, it, vi } from "vitest";

import {
	type DiscoverOverrideFunc,
	fakeLoad,
	makeDeps,
	okState,
	sampleConfig,
} from "#tests/helpers/reconcile-command";
import type { BedrockState } from "../../core/state.ts";
import type { DeployError } from "../../shell/deploy.ts";
import type { ProgDeps } from "../index.ts";
import type { Spawner, SpawnInvocation } from "../spawner.ts";
import { provisionCommand } from "./provision.ts";

type ProvisionFunc = NonNullable<ProgDeps["provision"]>;

function fakeProvision(result: Result<BedrockState, DeployError>): ProvisionFunc {
	return vi.fn<ProvisionFunc>(async () => result);
}

describe(provisionCommand, () => {
	it("should intro, dispatch provision, log the succeeded outro, and exit 0", async () => {
		expect.assertions(4);

		const provision = fakeProvision({ data: okState(), success: true });
		const deps = makeDeps({ loadConfig: fakeLoad(), provision });

		await provisionCommand(deps)({ env: "production" });

		expect(deps.clack!.intro).toHaveBeenCalledExactlyOnceWith("bedrock provision");
		expect(provision).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ config: sampleConfig, environment: "production" }),
		);
		expect(deps.clack!.outro).toHaveBeenCalledExactlyOnceWith("provision succeeded");
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it("should cancel with 'provision failed' and exit 1 when provision returns Err", async () => {
		expect.assertions(2);

		const provision = fakeProvision({
			err: { environment: "production", kind: "stateNotConfigured" },
			success: false,
		});
		const deps = makeDeps({ loadConfig: fakeLoad(), provision });

		await provisionCommand(deps)({ env: "production" });

		expect(deps.clack!.cancel).toHaveBeenCalledExactlyOnceWith("provision failed");
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should not discover a build override and dispatch provision without a build step", async () => {
		expect.assertions(3);

		const discoverOverride = vi.fn<DiscoverOverrideFunc>(() => {});
		const provision = fakeProvision({ data: okState(), success: true });
		const deps = makeDeps({
			discoverOverride,
			loadConfig: fakeLoad(),
			projectRoot: "/abs",
			provision,
		});

		await provisionCommand(deps)({ env: "production" });

		// provision is not a fused command: only its own override is discovered
		// and no build step is injected into the pipeline options.
		expect(discoverOverride).toHaveBeenCalledExactlyOnceWith("/abs", "provision");
		expect(provision).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ environment: "production" }),
		);
		expect(vi.mocked(provision).mock.calls[0]![0]).not.toHaveProperty("build");
	});

	it("should discover a .bedrock/provision.ts override and spawn it instead of provision()", async () => {
		expect.assertions(3);

		const invocations: Array<SpawnInvocation> = [];
		const spawner: Spawner = {
			async spawn(invocation) {
				invocations.push(invocation);
				return { data: 0, success: true };
			},
		};
		const discoverOverride = vi.fn<DiscoverOverrideFunc>(() => "/abs/.bedrock/provision.ts");
		const provision = vi.fn<ProvisionFunc>();
		const deps = makeDeps({
			discoverOverride,
			loadConfig: fakeLoad(),
			projectRoot: "/abs",
			provision,
			spawner,
		});

		await provisionCommand(deps)({ env: "production" });

		expect(discoverOverride).toHaveBeenCalledExactlyOnceWith("/abs", "provision");
		expect(provision).not.toHaveBeenCalled();
		expect(invocations[0]!.args[0]).toBe("/abs/.bedrock/provision.ts");
	});
});
