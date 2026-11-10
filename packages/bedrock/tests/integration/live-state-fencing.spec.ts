import {
	asResourceKey,
	asRobloxAssetId,
	type Config,
	deploy,
	type StateRecord,
} from "@bedrock-rbx/core";

import { describe, it } from "vitest";

import { concurrentStateStore } from "#tests/helpers/concurrent-state-store";
import { livePassFixture } from "#tests/helpers/live-game-pass";

const saved = livePassFixture(500);

describe("live deploy State fencing", () => {
	it.for<{ config: Config; label: string; record: StateRecord }>([
		{
			config: saved.options.config,
			label: "present",
			record: {
				state: saved.store.states.get("production")!,
				version: { kind: "present", token: "v1" },
			},
		},
		{
			config: { environments: { production: {} } },
			label: "absent",
			record: { version: { kind: "absent" } },
		},
	])(
		"should retain concurrent State after an initially $label observation",
		async ({ config, record }, { expect }) => {
			expect.hasAssertions();

			const subject = livePassFixture(500);
			const concurrent = {
				...subject.current,
				key: asResourceKey("concurrent"),
				outputs: { ...subject.current.outputs, assetId: asRobloxAssetId("999") },
			};
			const store = concurrentStateStore(record, {
				environment: "production",
				resources: [subject.current, concurrent],
				version: 1,
			});
			const result = await deploy({ ...subject.options, config, statePort: store.port });

			expect(result).toMatchObject({
				err: { cause: { kind: "stateConflict" }, kind: "stateWriteFailed" },
				success: false,
			});
			expect(store.state.resources.map(({ key }) => key)).toStrictEqual([
				"vip-pass",
				"concurrent",
			]);
		},
	);
});
