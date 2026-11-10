import { deploy, provision, publish } from "@bedrock-rbx/core";
import { OpenCloudError } from "@bedrock-rbx/ocale";
import { createFakeHttpClient, validGamePassBody } from "@bedrock-rbx/ocale/testing";

import { describe, it } from "vitest";

import { deployCommand } from "#src/cli/commands/deploy";
import { diffCommand } from "#src/cli/commands/diff";
import { provisionCommand } from "#src/cli/commands/provision";
import { publishCommand } from "#src/cli/commands/publish";
import { createProg } from "#src/cli/index";
import type { SpawnInvocation } from "#src/cli/spawner";
import { EMPTY_PLUGIN_REGISTRY } from "#src/core/plugin-registry";
import { previewDiffAsync } from "#src/shell/preview-diff";
import { asResourceKey, asRobloxAssetId } from "#src/types/ids";
import { environmentFrom } from "#tests/helpers/environment";
import { livePassFixture } from "#tests/helpers/live-game-pass";
import { makeDeps } from "#tests/helpers/reconcile-command";
import { gamePassCurrent } from "#tests/helpers/resources";
import { fakeStateStore } from "#tests/helpers/state-store";
import { captureStreams } from "#tests/helpers/streams";

function cliFixture(fixture = livePassFixture()) {
	const deps = makeDeps({
		deploy: async ({ credential: _credential, ...options }) => {
			return deploy({
				...fixture.options,
				...options,
			});
		},
		discoverOverride: () => {},
		loadProject: async () => {
			return {
				data: { config: fixture.options.config, plugins: EMPTY_PLUGIN_REGISTRY },
				success: true,
			};
		},
		previewDiff: async (options) => previewDiffAsync({ ...fixture.options, ...options }),
		provision: async ({ credential: _credential, ...options }) => {
			return provision({
				...fixture.options,
				...options,
			});
		},
		publish: async ({ credential: _credential, ...options }) => {
			return publish({
				...fixture.options,
				...options,
			});
		},
	});
	return { ...fixture, deps };
}

describe("cLI live options", () => {
	it("should explain each live-check flag in command help", ({ expect }) => {
		expect.hasAssertions();

		const { stdout } = captureStreams({ console: true });
		createProg().parse(["node", "bedrock", "diff", "--help"]);
		const help = stdout.join("");

		expect(help).toContain("Require the live check and an Open Cloud credential");
		expect(help).toContain("Disable the live check and compare against saved state");
		expect(help).toContain("Refuse before any operation when live edits exist");
	});

	it("should list every resource and field in an audit refusal", async ({ expect }) => {
		expect.hasAssertions();

		const current = gamePassCurrent();
		const other = gamePassCurrent({
			key: asResourceKey("other"),
			name: "Other",
			outputs: { ...current.outputs, assetId: asRobloxAssetId("2") },
		});
		const http = createFakeHttpClient().mockResponse({
			body: {
				gamePasses: [
					validGamePassBody({
						name: "Edited VIP",
						description: current.description,
						gamePassId: 9_876_543_210,
						priceInformation: { defaultPriceInRobux: 120, enabledFeatures: [] },
					}),
					validGamePassBody({
						name: other.name,
						description: other.description,
						gamePassId: 2,
						priceInformation: { defaultPriceInRobux: 400, enabledFeatures: [] },
					}),
				],
				// eslint-disable-next-line unicorn/no-null -- Terminal Roblox list page.
				nextPageToken: null,
			},
			status: 200,
		});
		const source = livePassFixture(120, http);
		const store = fakeStateStore({
			initial: {
				production: { environment: "production", resources: [current, other], version: 1 },
			},
		});
		const fixture = cliFixture(source);
		await diffCommand({
			...fixture.deps,
			loadProject: async () => {
				return {
					data: {
						config: {
							...source.options.config,
							passes: {
								...source.options.config.passes,
								other: {
									name: other.name,
									description: other.description,
									icon: other.icon,
									price: 500,
								},
							},
						},
						plugins: EMPTY_PLUGIN_REGISTRY,
					},
					success: true,
				};
			},
			previewDiff: async (options) => {
				return previewDiffAsync({ ...source.options, ...options, statePort: store.port });
			},
		})({ env: ["production"], failOnOutOfBandEdit: true });

		expect(fixture.deps.clack!.logError).toHaveBeenCalledWith(
			"out-of-band edits detected; refusing before any operation: gamePass:vip-pass (name: VIP Pass -> Edited VIP, price: 500 -> 120); gamePass:other (price: 500 -> 400)",
		);
		expect(store.writes).toBeEmpty();
	});

	it.for([deployCommand, provisionCommand, publishCommand, diffCommand])(
		"should require a credential for --live",
		async (command, { expect }) => {
			expect.hasAssertions();

			const store = fakeStateStore();
			const fixture = cliFixture();
			const deps = {
				...fixture.deps,
				deploy: async (options: Parameters<typeof deploy>[0]) => {
					return deploy({
						...options,
						getEnv: environmentFrom({}),
						statePort: store.port,
					});
				},
				previewDiff: async (options: Parameters<typeof previewDiffAsync>[0]) => {
					return previewDiffAsync({
						...options,
						getEnv: environmentFrom({}),
						readFile: async () => new Uint8Array(),
						statePort: store.port,
					});
				},
				provision: async (options: Parameters<typeof provision>[0]) => {
					return provision({
						...options,
						getEnv: environmentFrom({}),
						statePort: store.port,
					});
				},
				publish: async (options: Parameters<typeof publish>[0]) => {
					return publish({
						...options,
						getEnv: environmentFrom({}),
						statePort: store.port,
					});
				},
			};
			await command(deps)({ env: ["production"], live: true });

			expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
			expect(deps.clack!.logError).toHaveBeenCalledWith(
				"missing credential: environment variable BEDROCK_API_KEY is not set",
			);
			expect(store.writes).toBeEmpty();
		},
	);

	it.for([{ live: "yes" }, { "fail-on-out-of-band-edit": "yes" }])(
		"should reject a value supplied to a live switch",
		async (flags, { expect }) => {
			expect.hasAssertions();

			const fixture = cliFixture();
			await diffCommand(fixture.deps)({ env: ["production"], ...flags });

			expect(fixture.deps.exit).toHaveBeenCalledExactlyOnceWith(1);
			expect(fixture.httpClient.requests).toBeEmpty();
			expect(fixture.deps.clack!.logError).toHaveBeenCalledWith(
				expect.stringContaining("takes no value"),
			);
		},
	);

	it("should report a deploy live-read failure before applying", async ({ expect }) => {
		expect.hasAssertions();

		const fixture = cliFixture(
			livePassFixture(
				120,
				createFakeHttpClient().mockError(new OpenCloudError("read failed")),
			),
		);
		await deployCommand(fixture.deps)({ env: ["production"] });

		expect(fixture.deps.clack!.logError).toHaveBeenCalledWith(
			"live check failed for gamePass: read failed",
		);
		expect(fixture.store.writes).toBeEmpty();
	});

	it.for([
		{
			args: ["--live", "--fail-on-out-of-band-edit"],
			flags: { failOnOutOfBandEdit: true, live: true },
		},
		{ args: ["--no-live"], flags: { failOnOutOfBandEdit: false, live: false } },
	])(
		"should forward live controls to a project override",
		async ({ args, flags }, { expect }) => {
			expect.hasAssertions();

			const fixture = cliFixture();
			const sent: Array<SpawnInvocation> = [];
			await deployCommand({
				...fixture.deps,
				discoverOverride: () => "D:/project/.bedrock/deploy.ts",
				spawner: {
					spawn: async (input) => {
						sent.push(input);
						return { data: 0, success: true };
					},
				},
			})({ env: ["production"], ...flags });

			expect(sent[0]!.args).toStrictEqual([
				"D:/project/.bedrock/deploy.ts",
				"--env",
				"production",
				...args,
			]);
			expect(fixture.httpClient.requests).toBeEmpty();
		},
	);

	it.for([deployCommand, provisionCommand, publishCommand, diffCommand])(
		"should refuse an audit and name the edits",
		async (command, { expect }) => {
			expect.hasAssertions();

			const fixture = cliFixture();
			await command(fixture.deps)({
				"env": ["production"],
				"fail-on-out-of-band-edit": true,
			});

			expect(fixture.deps.exit).toHaveBeenCalledExactlyOnceWith(1);
			expect(fixture.deps.clack!.logError).toHaveBeenCalledWith(
				expect.stringContaining("gamePass:vip-pass (price: 500 -> 120)"),
			);
			expect(fixture.httpClient.requests.map(({ request }) => request.method)).toStrictEqual([
				"GET",
			]);
			expect(fixture.store.writes).toBeEmpty();
		},
	);

	it.for([deployCommand, provisionCommand, diffCommand])(
		"should disable live reads and visibly report the skip",
		async (command, { expect }) => {
			expect.hasAssertions();

			const fixture = cliFixture();
			await command(fixture.deps)({ env: ["production"], live: false });

			expect(fixture.deps.exit).toHaveBeenCalledExactlyOnceWith(0);
			expect(fixture.httpClient.requests).toBeEmpty();
			expect(fixture.deps.clack!.logMessage).toHaveBeenCalledWith(
				expect.stringContaining("gamePass (disabled)"),
			);
		},
	);

	it("should parse the registered negative flag through sade", async ({ expect }) => {
		expect.hasAssertions();

		const fixture = cliFixture();
		let finish!: (code: number) => void;
		const finished = new Promise<number>((resolve) => {
			finish = resolve;
		});
		createProg({ ...fixture.deps, exit: finish }).parse([
			"node",
			"bedrock",
			"diff",
			"--env",
			"production",
			"--no-live",
		]);

		await expect(finished).resolves.toBe(0);
		expect(fixture.deps.clack!.logError).not.toHaveBeenCalled();
		expect(fixture.httpClient.requests).toBeEmpty();
	});
});
