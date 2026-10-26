import { describe, it, vi } from "vitest";

import { diffCommand } from "#src/cli/commands/diff";
import { EMPTY_PLUGIN_REGISTRY } from "#src/core/plugin-registry";
import { asResourceKey, type BedrockState, type Config } from "#src/index";
import { previewDiffAsync } from "#src/shell/preview-diff";
import { fakeClackPort } from "#tests/helpers/clack";
import { gamePassCurrent, placeCurrent } from "#tests/helpers/resources";
import { fakeStateStore } from "#tests/helpers/state-store";

describe("rename diff CLI", () => {
	it("should report both conflicting keys without writing state", async ({ expect }) => {
		expect.assertions(3);

		const config: Config = {
			environments: { production: {} },
			passes: {
				newer: {
					name: "VIP",
					description: "Perks",
					icon: { "en-us": "vip.png" },
					movedFrom: "old",
				},
			},
		};
		const initial: BedrockState = {
			environment: "production",
			resources: [
				gamePassCurrent({ key: asResourceKey("old") }),
				gamePassCurrent({ key: asResourceKey("newer") }),
			],
			version: 1,
		};
		const store = fakeStateStore({ initial: { production: initial } });
		const clack = fakeClackPort();
		const exit = vi.fn<(code: number) => void>();
		await diffCommand({
			clack,
			exit,
			async loadProject() {
				return { data: { config, plugins: EMPTY_PLUGIN_REGISTRY }, success: true };
			},
			previewDiff: async (options) => {
				return previewDiffAsync({
					...options,
					async readFile() {
						return new Uint8Array();
					},
					statePort: store.port,
				});
			},
		})({ env: "production" });

		expect(clack.logError).toHaveBeenCalledWith(
			expect.stringContaining(
				"Cannot move 'old' to 'newer' (gamePass): both keys have current state.",
			),
		);
		expect(exit).toHaveBeenCalledWith(1);
		expect(store.writes).toStrictEqual([]);
	});

	it("should report pending publication under the implicit new place key without mutating state", async ({
		expect,
	}) => {
		expect.assertions(3);

		const config: Config = {
			environments: { production: { places: { lobby: { placeId: "4711" } } } },
			places: { lobby: {} },
		};
		const initial: BedrockState = {
			environment: "production",
			pendingRebuild: new Set([asResourceKey("start-place")]),
			resources: [placeCurrent({ fileHash: undefined, filePath: undefined })],
			version: 1,
		};
		const store = fakeStateStore({ initial: { production: initial } });
		const clack = fakeClackPort();
		const exit = vi.fn<(code: number) => void>();
		await diffCommand({
			clack,
			exit,
			async loadProject() {
				return { data: { config, plugins: EMPTY_PLUGIN_REGISTRY }, success: true };
			},
			previewDiff: async (options) => previewDiffAsync({ ...options, statePort: store.port }),
		})({ env: "production" });

		expect(clack.logMessage).toHaveBeenCalledWith(
			'1 place(s) minted but unpublished in "production": lobby',
		);
		expect(exit).toHaveBeenCalledWith(0);
		expect(store.states.get("production")).toBe(initial);
	});
});
