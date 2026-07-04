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
import { publishCommand } from "./publish.ts";

type PublishFunc = NonNullable<ProgDeps["publish"]>;

function fakePublish(result: Result<BedrockState, DeployError>): PublishFunc {
	return vi.fn<PublishFunc>(async () => result);
}

describe(publishCommand, () => {
	it("should intro, dispatch publish, log the succeeded outro, and exit 0", async () => {
		expect.assertions(4);

		const publish = fakePublish({ data: okState(), success: true });
		const deps = makeDeps({ loadConfig: fakeLoad(), publish });

		await publishCommand(deps)({ env: "production" });

		expect(deps.clack?.intro).toHaveBeenCalledExactlyOnceWith("bedrock publish");
		expect(publish).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ config: sampleConfig, environment: "production" }),
		);
		expect(deps.clack?.outro).toHaveBeenCalledExactlyOnceWith("publish succeeded");
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it("should cancel with 'publish failed' and exit 1 when publish returns Err", async () => {
		expect.assertions(2);

		const publish = fakePublish({
			err: { environment: "production", kind: "stateNotConfigured" },
			success: false,
		});
		const deps = makeDeps({ loadConfig: fakeLoad(), publish });

		await publishCommand(deps)({ env: "production" });

		expect(deps.clack?.cancel).toHaveBeenCalledExactlyOnceWith("publish failed");
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should discover a .bedrock/publish.ts override and spawn it instead of publish()", async () => {
		expect.assertions(3);

		const invocations: Array<SpawnInvocation> = [];
		const spawner: Spawner = {
			async spawn(invocation) {
				invocations.push(invocation);
				return { data: 0, success: true };
			},
		};
		const discoverOverride = vi.fn<DiscoverOverrideFunc>(() => "/abs/.bedrock/publish.ts");
		const publish = vi.fn<PublishFunc>();
		const deps = makeDeps({
			discoverOverride,
			loadConfig: fakeLoad(),
			projectRoot: "/abs",
			publish,
			spawner,
		});

		await publishCommand(deps)({ env: "production" });

		expect(discoverOverride).toHaveBeenCalledExactlyOnceWith("/abs", "publish");
		expect(publish).not.toHaveBeenCalled();
		expect(invocations[0]?.args[0]).toBe("/abs/.bedrock/publish.ts");
	});
});
