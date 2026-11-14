import {
	asRobloxAssetId,
	type Config,
	type EnvironmentEntry,
	type RobloxAssetId,
} from "@bedrock-rbx/core";
import { NetworkError } from "@bedrock-rbx/ocale";

import { describe, it, vi } from "vitest";

import { diffCommand } from "#src/cli/commands/diff";
import { createProg, type ProgDeps } from "#src/cli/index";
import { EMPTY_PLUGIN_REGISTRY } from "#src/core/plugin-registry";
import { previewDiffAsync } from "#src/shell/preview-diff";
import { makeDeps } from "#tests/helpers/reconcile-command";
import { fakeStateStore } from "#tests/helpers/state-store";
import { captureStreams } from "#tests/helpers/streams";

const UNIVERSE_ID = asRobloxAssetId("1234567890");
const LIVE_CHECK_SKIPPED =
	"Live check: checked none; skipped badge (no Open Cloud credential), developerProduct (no Open Cloud credential), gamePass (no Open Cloud credential), place (no Open Cloud credential), universe (no Open Cloud credential). Name check skipped for badge, developerProduct, gamePass: planned creates are not checked against untracked live items.";

function badge(name: string): { description: string; icon: { "en-us": string }; name: string } {
	return { name, description: `Earn ${name}.`, icon: { "en-us": "assets/badge.png" } };
}

function config(
	environment: Pick<EnvironmentEntry, "allowDeferredCreates" | "spendLimit">,
	universe?: { readonly universeId: RobloxAssetId },
): Config {
	return {
		badges: Object.fromEntries(
			["a-badge", "b-badge", "c-badge"].map((key) => [key, badge(key)]),
		),
		environments: { production: environment },
		...(universe === undefined ? {} : { universe }),
	};
}

async function readIconAsync(): Promise<Uint8Array> {
	return new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
}

function diffDeps(
	project: Config,
	left: number | undefined,
): { deps: ProgDeps; priceReads: Array<true> } {
	const priceReads: Array<true> = [];
	const deps = makeDeps({
		loadProject: async () => {
			return { data: { config: project, plugins: EMPTY_PLUGIN_REGISTRY }, success: true };
		},
		previewDiff: async (input) => {
			return previewDiffAsync({
				...input,
				readBadgeCreationPrice: async () => {
					priceReads.push(true);
					return { data: 100, success: true };
				},
				readFile: readIconAsync,
				readFreeBadgeQuota: async () => {
					return left === undefined
						? { err: new NetworkError("socket hang up"), success: false }
						: { data: left, success: true };
				},
				statePort: fakeStateStore().port,
			});
		},
	});
	return { deps, priceReads };
}

function messages(deps: ProgDeps): Array<unknown> {
	return vi.mocked(deps.clack!.logMessage).mock.calls.flat();
}

describe("paid badge creates in bedrock diff", () => {
	it("should show the paid creates, price, total, and limit with --allow-spend", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { deps } = diffDeps(config({ spendLimit: 500 }), 1);
		await diffCommand(deps)({ "allow-spend": true, "env": "production" });

		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(0);
		expect(messages(deps)).toStrictEqual([
			'Drift for "production":',
			"+ badge:a-badge a-badge",
			"+ badge:b-badge b-badge",
			"+ badge:c-badge c-badge",
			'2 paid badge creates in "production": 100 Robux each, 200 Robux of the 500 Robux spend limit',
			LIVE_CHECK_SKIPPED,
		]);
	});

	it("should refuse a diff without --allow-spend and name what it would pay", async ({
		expect,
	}) => {
		expect.hasAssertions();

		vi.useFakeTimers({ now: new Date("2026-11-14T15:30:00.000Z"), toFake: ["Date"] });
		const { deps } = diffDeps(config({ spendLimit: 500 }), 1);
		await diffCommand(deps)({ env: "production" });
		vi.useRealTimers();

		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
		expect(deps.clack!.logError).toHaveBeenCalledWith(
			"deploy refused: 3 badge creates needed, 1 free left today; --allow-spend pays for the other 2: 100 Robux each, 200 Robux of the 500 Robux spend limit; the free badge quota resets at 2026-11-15 00:00 UTC",
		);
	});

	it.for([
		{
			line: '--allow-spend pays for 1 of the 2 deferred badge creates in "production": 100 Robux each, 100 Robux of the 150 Robux spend limit',
			spendLimit: 150,
		},
		{
			line: '--allow-spend pays for 2 of the 2 deferred badge creates in "production": 100 Robux each, 200 Robux of the 500 Robux spend limit',
			spendLimit: 500,
		},
	])(
		"should name what --allow-spend would pay for deferred creates under a $spendLimit Robux limit",
		async ({ line, spendLimit }, { expect }) => {
			expect.hasAssertions();

			const { deps } = diffDeps(config({ allowDeferredCreates: true, spendLimit }), 1);
			await diffCommand(deps)({ env: "production" });

			expect(deps.exit).toHaveBeenCalledExactlyOnceWith(0);
			expect(messages(deps)).toStrictEqual([
				'Drift for "production":',
				"+ badge:a-badge a-badge",
				"+ badge:b-badge b-badge create (deferred: no free badge quota)",
				"+ badge:c-badge c-badge create (deferred: no free badge quota)",
				line,
				LIVE_CHECK_SKIPPED,
			]);
		},
	);

	it("should not name a payment the spend limit cannot cover for any deferred create", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { deps } = diffDeps(config({ allowDeferredCreates: true, spendLimit: 50 }), 1);
		await diffCommand(deps)({ env: "production" });

		expect(messages(deps)).toStrictEqual([
			'Drift for "production":',
			"+ badge:a-badge a-badge",
			"+ badge:b-badge b-badge create (deferred: no free badge quota)",
			"+ badge:c-badge c-badge create (deferred: no free badge quota)",
			LIVE_CHECK_SKIPPED,
		]);
	});

	it("should show the worst-case paid creates with --allow-spend when the free quota cannot be read", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { deps } = diffDeps(config({ spendLimit: 500 }), undefined);
		await diffCommand(deps)({ "allow-spend": true, "env": "production" });

		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(0);
		expect(messages(deps)).toStrictEqual([
			'Drift for "production":',
			"+ badge:a-badge a-badge",
			"+ badge:b-badge b-badge",
			"+ badge:c-badge c-badge",
			'up to 3 paid badge creates in "production", the free badge quota is unknown: 100 Robux each, 300 Robux of the 500 Robux spend limit',
			LIVE_CHECK_SKIPPED,
		]);
	});

	it("should refuse a diff of an unknown quota without --allow-spend and name what it would pay", async ({
		expect,
	}) => {
		expect.hasAssertions();

		vi.useFakeTimers({ now: new Date("2026-11-14T15:30:00.000Z"), toFake: ["Date"] });
		const { deps } = diffDeps(config({ spendLimit: 500 }), undefined);
		await diffCommand(deps)({ env: "production" });
		vi.useRealTimers();

		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
		expect(deps.clack!.logError).toHaveBeenCalledWith(
			"deploy refused: 3 badge creates needed, but the free badge quota could not be read: socket hang up; --allow-spend pays for all 3: 100 Robux each, 300 Robux of the 500 Robux spend limit; the free badge quota resets at 2026-11-15 00:00 UTC",
		);
	});

	it.for([
		{
			allowSpend: true,
			result: {
				data: {
					spendQuote: {
						approved: true,
						limit: 500,
						paid: 3,
						price: 100,
						worstCase: true,
					},
				},
				success: true,
			},
		},
		{
			allowSpend: false,
			result: {
				err: {
					spendQuote: {
						approved: false,
						limit: 500,
						paid: 3,
						price: 100,
						worstCase: true,
					},
				},
				success: false,
			},
		},
	])(
		"should quote every create as the worst case of an unknown quota with spend approval $allowSpend",
		async ({ allowSpend, result }, { expect }) => {
			expect.hasAssertions();

			const preview = await previewDiffAsync({
				allowSpend,
				config: config({ spendLimit: 500 }),
				environment: "production",
				readBadgeCreationPrice: async () => ({ data: 100, success: true }),
				readFile: readIconAsync,
				readFreeBadgeQuota: async () => {
					return { err: new NetworkError("socket hang up"), success: false };
				},
				statePort: fakeStateStore().port,
			});

			expect(preview).toMatchObject(result);
		},
	);

	it("should leave a diff without a shortfall unchanged", async ({ expect }) => {
		expect.hasAssertions();

		const { deps, priceReads } = diffDeps(config({ spendLimit: 500 }), 3);
		await diffCommand(deps)({ "allow-spend": true, "env": "production" });

		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(0);
		expect(messages(deps)).toStrictEqual([
			'Drift for "production":',
			"+ badge:a-badge a-badge",
			"+ badge:b-badge b-badge",
			"+ badge:c-badge c-badge",
			LIVE_CHECK_SKIPPED,
		]);
		expect(priceReads).toBeEmpty();
	});

	it("should read the badge creation price from Roblox by default", async ({
		expect,
		onTestFinished,
	}) => {
		expect.hasAssertions();

		const urls: Array<string> = [];
		const bodies: Array<JSONValue> = [1, { badgeCreationPrice: 100 }];
		vi.stubGlobal("fetch", async (url: string) => {
			urls.push(url);
			return Response.json(bodies.shift());
		});
		onTestFinished(() => {
			vi.unstubAllGlobals();
		});

		const result = await previewDiffAsync({
			allowSpend: true,
			config: config({ spendLimit: 500 }, { universeId: UNIVERSE_ID }),
			environment: "production",
			readFile: readIconAsync,
			statePort: fakeStateStore().port,
		});

		expect(result).toMatchObject({
			data: { spendQuote: { approved: true, limit: 500, paid: 2, price: 100 } },
			success: true,
		});
		expect(urls).toStrictEqual([
			`https://badges.roblox.com/v1/universes/${UNIVERSE_ID}/free-badges-quota`,
			"https://badges.roblox.com/v1/badges/metadata",
		]);
	});

	it("should explain --allow-spend in diff help", ({ expect }) => {
		expect.hasAssertions();

		const { stdout } = captureStreams({ console: true });
		createProg().parse(["node", "bedrock", "diff", "--help"]);

		expect(stdout.join("")).toContain(
			"Show what deploy --allow-spend would pay for badge creates beyond the free quota",
		);
	});
});
