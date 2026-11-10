import {
	asResourceKey,
	asRobloxAssetId,
	asSha256Hex,
	type Config,
	deploy,
	type StateRecord,
} from "@bedrock-rbx/core";

import { describe, it } from "vitest";

import {
	concurrentStateStore,
	mutableFencedStateStore,
} from "#tests/helpers/concurrent-state-store";
import { livePassFixture } from "#tests/helpers/live-game-pass";
import { placeCurrent } from "#tests/helpers/resources";

const saved = livePassFixture(500);

describe("live deploy State fencing", () => {
	it("should refuse a concurrently changed checkpoint before a later stage can replace unmanaged metadata", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const subject = livePassFixture(500);
		const place = placeCurrent({
			fileHash: asSha256Hex(
				"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
			),
		});
		const store = mutableFencedStateStore({
			environment: "production",
			resources: [subject.current, place],
			version: 1,
		});
		const result = await deploy({
			...subject.options,
			build: async () => {
				store.replace({
					...store.state,
					resources: [
						store.state.resources[0]!,
						{ ...place, description: "Concurrent description" },
					],
				});
			},
			codegenWriter: { write: async () => ({ data: undefined, success: true }) },
			config: {
				...subject.options.config,
				codegen: { enabled: true },
				environments: { production: { places: { "start-place": { placeId: "4711" } } } },
				places: { "start-place": { filePath: "places/start.rbxl" } },
			},
			emit: () => [],
			statePort: store.port,
		});

		expect(result).toMatchObject({
			err: {
				cause: {
					kind: "stateConflict",
					reason: "State changed after the deployment checkpoint",
				},
				kind: "stateReadFailed",
			},
			success: false,
		});
		expect(store.state.resources.find(({ kind }) => kind === "place")).toMatchObject({
			description: "Concurrent description",
		});
		expect(subject.httpClient.requests.map(({ request }) => request.method)).toStrictEqual([
			"GET",
		]);
	});

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
