import {
	asRobloxAssetId,
	type CodegenFile,
	type Config,
	createBadgeDriver,
	createClackProgressAdapter,
	deploy,
	type DriverRegistry,
	provision,
	publish,
} from "@bedrock-rbx/core";
import { ApiError, BadgeCostMismatchError, NetworkError } from "@bedrock-rbx/ocale";
import { BadgesClient } from "@bedrock-rbx/ocale/badges";
import {
	createFakeHttpClient,
	type FakeHttpClient,
	validBadgeBody,
} from "@bedrock-rbx/ocale/testing";

import { assert, describe, it, vi } from "vitest";

import { diffCommand } from "#src/cli/commands/diff";
import { EMPTY_PLUGIN_REGISTRY } from "#src/core/plugin-registry";
import { REDACTED_ICON_BYTES } from "#src/core/redacted-icon";
import { previewDiffAsync } from "#src/shell/preview-diff";
import { fakeClackPort } from "#tests/helpers/clack";
import { makeDeps } from "#tests/helpers/reconcile-command";
import { badgeCurrent, gamePassCurrent } from "#tests/helpers/resources";
import { fakeStateStore } from "#tests/helpers/state-store";

const ICON_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x01]);
const NEW_ICON = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x02]);
const UNIVERSE_ID = asRobloxAssetId("1234567890");
const FIRST_WIN = {
	name: "First Win",
	description: "Win your first round.",
	icon: { "en-us": "assets/first-win.png" },
} as const;

const CONFIG = {
	badges: { "first-win": FIRST_WIN },
	environments: { production: {} },
} satisfies Config;

const trap = {
	async create(): Promise<never> {
		throw new Error("Unexpected create");
	},
	async retire(): Promise<never> {
		throw new Error("Unexpected retire");
	},
};

async function readIconAsync(path: string): Promise<Uint8Array> {
	if (path !== "assets/first-win.png") {
		throw new Error(`Unexpected read of ${path}`);
	}

	return ICON_BYTES;
}

async function readNewIconAsync(path: string): Promise<Uint8Array> {
	await readIconAsync(path);
	return NEW_ICON;
}

async function noFilesAsync(): Promise<never> {
	throw new Error("Retirement must not read local icons");
}

function trackedStore(): ReturnType<typeof fakeStateStore> {
	return fakeStateStore({
		initial: {
			production: { environment: "production", resources: [badgeCurrent()], version: 1 },
		},
	});
}

function registry(httpClient: FakeHttpClient): DriverRegistry {
	return {
		badge: createBadgeDriver({
			client: new BadgesClient({
				credential: { apiKey: "fake", kind: "apiKey" },
				httpClient,
				sleep: async () => {},
			}),
			readFile: readIconAsync,
			universeId: UNIVERSE_ID,
		}),
		developerProduct: trap,
		gamePass: trap,
		place: trap,
		universe: trap,
	};
}

const QUOTA_URL = `/v1/universes/${UNIVERSE_ID}/free-badges-quota`;
const CREATE_URL = `/legacy-badges/v1/universes/${UNIVERSE_ID}/badges`;

function freeQuota(left: number): FakeHttpClient {
	return createFakeHttpClient().mockResponse({ body: left, status: 200 });
}

function createdBadge(httpClient = freeQuota(5)): FakeHttpClient {
	return httpClient.mockResponse({
		body: validBadgeBody({ id: 2_468_013_579, iconImageId: 1_357_924_680 }),
		status: 200,
	});
}

function requestLines(httpClient: FakeHttpClient): Array<[string, string]> {
	return httpClient.requests.map(({ request }) => [request.method, request.url]);
}

function freezeDate(onTestFinished: (cleanup: () => void) => void, iso: string): void {
	vi.useFakeTimers({ now: new Date(iso), toFake: ["Date"] });
	onTestFinished(() => {
		vi.useRealTimers();
	});
}

function formFields(body: FormData): Record<string, Blob | string> {
	return Object.fromEntries(Array.from(body.keys(), (key) => [key, body.get(key)!]));
}

function sentFields(httpClient: FakeHttpClient): Record<string, Blob | string> {
	const { body } = httpClient.requests.find(({ request }) => request.method === "POST")!.request;
	assert(body instanceof FormData);
	return formFields(body);
}

describe("badges", () => {
	it("should create a declared badge for free and record its badge and icon IDs", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const httpClient = createdBadge();
		const store = fakeStateStore();
		const result = await deploy({
			config: CONFIG,
			environment: "production",
			readFile: readIconAsync,
			registry: registry(httpClient),
			statePort: store.port,
		});

		assert(result.success);

		expect(requestLines(httpClient)).toStrictEqual([
			["GET", QUOTA_URL],
			["POST", CREATE_URL],
		]);

		const { files, ...fields } = sentFields(httpClient);

		expect(fields).toStrictEqual({
			name: "First Win",
			description: "Win your first round.",
			expectedCost: "0",
			isActive: "true",
		});

		assert(files instanceof Blob);

		expect(new Uint8Array(await files.arrayBuffer())).toStrictEqual(ICON_BYTES);
		expect(store.states.get("production")!.resources).toMatchObject([
			{
				key: "first-win",
				name: "First Win",
				enabled: true,
				kind: "badge",
				outputs: { badgeId: "2468013579", iconImageId: "1357924680" },
			},
		]);
	});

	it.for([
		{ environment: {}, expected: "false", root: { ...FIRST_WIN, enabled: false } },
		{
			environment: { badges: { "first-win": { enabled: false } } },
			expected: "false",
			root: FIRST_WIN,
		},
		{
			environment: { badges: { "first-win": { enabled: true } } },
			expected: "true",
			root: { ...FIRST_WIN, enabled: false },
		},
	])(
		"should create the badge as active $expected from the merged enabled field",
		async ({ environment, expected, root }, { expect }) => {
			expect.hasAssertions();

			const httpClient = createdBadge();
			const result = await deploy({
				config: {
					badges: { "first-win": root },
					environments: { production: environment },
				},
				environment: "production",
				readFile: readIconAsync,
				registry: registry(httpClient),
				statePort: fakeStateStore().port,
			});

			assert(result.success);

			expect(sentFields(httpClient)["isActive"]).toBe(expected);
			expect(result.data.resources).toMatchObject([{ enabled: expected === "true" }]);
		},
	);

	it("should take an overlay's name and description over the root entry", async ({ expect }) => {
		expect.hasAssertions();

		const httpClient = createdBadge();
		const result = await deploy({
			config: {
				badges: { "first-win": FIRST_WIN },
				environments: {
					production: {
						badges: { "first-win": { name: "Opening Win", description: "Staged." } },
					},
				},
			},
			environment: "production",
			readFile: readIconAsync,
			registry: registry(httpClient),
			statePort: fakeStateStore().port,
		});

		assert(result.success);

		expect(sentFields(httpClient)).toMatchObject({
			name: "Opening Win",
			description: "Staged.",
		});
	});

	it("should send no badge request when a second deploy finds the config unchanged", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const store = fakeStateStore();
		const first = await deploy({
			config: CONFIG,
			environment: "production",
			readFile: readIconAsync,
			registry: registry(createdBadge()),
			statePort: store.port,
		});

		assert(first.success);

		const httpClient = createFakeHttpClient();
		const second = await deploy({
			config: CONFIG,
			environment: "production",
			readFile: readIconAsync,
			registry: registry(httpClient),
			statePort: store.port,
		});

		expect(second).toStrictEqual(first);
		expect(httpClient.requests).toBeEmpty();
	});

	it.for([
		{ change: { name: "Opening Win" }, sent: { name: "Opening Win" } },
		{ change: { description: "Staged." }, sent: { description: "Staged." } },
		{ change: { enabled: false }, sent: { enabled: false } },
	])(
		"should send only the changed field when a deployed badge changes to $sent",
		async ({ change, sent }, { expect }) => {
			expect.hasAssertions();

			const store = fakeStateStore();
			const first = await deploy({
				config: CONFIG,
				environment: "production",
				readFile: readIconAsync,
				registry: registry(createdBadge()),
				statePort: store.port,
			});

			assert(first.success);

			const httpClient = createFakeHttpClient().mockResponse({ body: {}, status: 200 });
			const second = await deploy({
				config: { ...CONFIG, badges: { "first-win": { ...FIRST_WIN, ...change } } },
				environment: "production",
				readFile: readIconAsync,
				registry: registry(httpClient),
				statePort: store.port,
			});

			assert(second.success);

			expect(
				httpClient.requests.map(({ request }) => [
					request.method,
					request.url,
					request.body,
				]),
			).toStrictEqual([["PATCH", "/legacy-badges/v1/badges/2468013579", sent]]);
			expect(store.states.get("production")!.resources).toMatchObject([
				{
					...change,
					outputs: { badgeId: "2468013579", iconImageId: "1357924680" },
				},
			]);
		},
	);

	it("should re-upload a changed icon and record its new icon ID in state and codegen", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const store = fakeStateStore();
		const first = await deploy({
			config: CONFIG,
			environment: "production",
			readFile: readIconAsync,
			registry: registry(createdBadge()),
			statePort: store.port,
		});

		assert(first.success);

		const httpClient = createFakeHttpClient().mockResponse({
			body: { targetId: 9_753_186_420 },
			status: 200,
		});
		const writes: Array<CodegenFile> = [];
		const second = await deploy({
			codegenWriter: {
				async write(file) {
					writes.push(file);
					return { data: undefined, success: true };
				},
			},
			config: { ...CONFIG, codegen: { enabled: true } },
			environment: "production",
			readFile: readNewIconAsync,
			registry: {
				...registry(httpClient),
				badge: createBadgeDriver({
					client: new BadgesClient({
						credential: { apiKey: "fake", kind: "apiKey" },
						httpClient,
						sleep: async () => {},
					}),
					readFile: readNewIconAsync,
					universeId: UNIVERSE_ID,
				}),
			},
			statePort: store.port,
		});

		assert(second.success);

		expect(
			httpClient.requests.map(({ request }) => [request.method, request.url]),
		).toStrictEqual([["POST", "/legacy-publish/v1/badges/2468013579/icon"]]);

		const { body } = httpClient.requests[0]!.request;
		assert(body instanceof FormData);
		const file = body.get("Files");
		assert(file instanceof Blob);

		expect(new Uint8Array(await file.arrayBuffer())).toStrictEqual(NEW_ICON);
		expect(store.states.get("production")!.resources).toMatchObject([
			{ outputs: { badgeId: "2468013579", iconImageId: "9753186420" } },
		]);
		expect(writes.map(({ content }) => content).join("\n")).toContain(
			"\t\t\ticonImageId = 9753186420,",
		);
	});

	it("should send no upload when the icon file is rewritten with the same content", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const store = fakeStateStore();
		const first = await deploy({
			config: CONFIG,
			environment: "production",
			readFile: readIconAsync,
			registry: registry(createdBadge()),
			statePort: store.port,
		});

		assert(first.success);

		const httpClient = createFakeHttpClient();
		const second = await deploy({
			config: CONFIG,
			environment: "production",
			readFile: async (path) => new Uint8Array(await readIconAsync(path)),
			registry: registry(httpClient),
			statePort: store.port,
		});

		assert(second.success);

		expect(httpClient.requests).toBeEmpty();
	});

	it("should emit each created badge's badge and icon IDs to codegen", async ({ expect }) => {
		expect.hasAssertions();

		const writes: Array<CodegenFile> = [];
		const result = await deploy({
			codegenWriter: {
				async write(file) {
					writes.push(file);
					return { data: undefined, success: true };
				},
			},
			config: { ...CONFIG, codegen: { enabled: true } },
			environment: "production",
			readFile: readIconAsync,
			registry: registry(createdBadge()),
			statePort: fakeStateStore().port,
		});

		assert(result.success);

		expect(writes.map(({ content }) => content).join("\n")).toContain(
			[
				'\t\t["first-win"] = {',
				"\t\t\tbadgeId = 2468013579,",
				"\t\t\ticonImageId = 1357924680,",
				"\t\t},",
			].join("\n"),
		);
	});

	it("should report the created badge by key and badge ID", async ({ expect }) => {
		expect.hasAssertions();

		const clack = fakeClackPort();
		const result = await provision({
			config: CONFIG,
			environment: "production",
			progress: createClackProgressAdapter({ clack }),
			readFile: readIconAsync,
			registry: registry(createdBadge()),
			statePort: fakeStateStore().port,
		});

		assert(result.success);

		expect(clack.logSuccess).toHaveBeenCalledWith("badge.first-win created (id 2468013579)");
	});

	it("should preview a new badge's create by key and name", async ({ expect }) => {
		expect.hasAssertions();

		const deps = makeDeps({
			loadProject: async () => {
				return { data: { config: CONFIG, plugins: EMPTY_PLUGIN_REGISTRY }, success: true };
			},
			previewDiff: async (input) => {
				return previewDiffAsync({
					...input,
					readFile: readIconAsync,
					readFreeBadgeQuota: async () => ({ data: 5, success: true }),
					statePort: fakeStateStore().port,
				});
			},
		});
		await diffCommand(deps)({ env: "production" });

		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(0);
		expect(deps.clack!.logMessage).toHaveBeenCalledWith("+ badge:first-win First Win");
	});

	it("should refuse a diff whose badge creates exceed the free quota with the counts and reset", async ({
		expect,
		onTestFinished,
	}) => {
		expect.hasAssertions();

		freezeDate(onTestFinished, "2026-10-27T23:59:59.000Z");
		const deps = makeDeps({
			loadProject: async () => {
				return { data: { config: CONFIG, plugins: EMPTY_PLUGIN_REGISTRY }, success: true };
			},
			previewDiff: async (input) => {
				return previewDiffAsync({
					...input,
					readFile: readIconAsync,
					readFreeBadgeQuota: async () => ({ data: 0, success: true }),
					statePort: fakeStateStore().port,
				});
			},
		});
		await diffCommand(deps)({ env: "production" });

		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
		expect(deps.clack!.logError).toHaveBeenCalledWith(
			"deploy refused: 1 badge create needed, 0 free left today; the free badge quota resets at 2026-10-28 00:00 UTC",
		);
		expect(deps.clack!.logMessage).not.toHaveBeenCalledWith("+ badge:first-win First Win");
	});

	it("should preview against the universe's free quota read from Roblox", async ({
		expect,
		onTestFinished,
	}) => {
		expect.hasAssertions();

		const urls: Array<string> = [];
		vi.stubGlobal("fetch", async (url: string) => {
			urls.push(url);
			return Response.json(0);
		});
		onTestFinished(() => {
			vi.unstubAllGlobals();
		});

		const result = await previewDiffAsync({
			config: { ...CONFIG, universe: { universeId: UNIVERSE_ID } },
			environment: "production",
			readFile: readIconAsync,
			statePort: fakeStateStore().port,
		});

		expect(result).toMatchObject({
			err: { available: 0, kind: "badgeQuotaExceeded", needed: 1 },
			success: false,
		});
		expect(urls).toStrictEqual([
			`https://badges.roblox.com/v1/universes/${UNIVERSE_ID}/free-badges-quota`,
		]);
	});

	it("should refuse a preview creating badges when no universe ID names the quota to read", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const result = await previewDiffAsync({
			config: CONFIG,
			environment: "production",
			readFile: readIconAsync,
			statePort: fakeStateStore().port,
		});

		assert(!result.success);

		expect(result.err).toMatchObject({ available: undefined, kind: "badgeQuotaExceeded" });
		expect(result.err).not.toHaveProperty("cause");
	});

	it("should refuse a deploy whose badge creates exceed the free quota before any write", async ({
		expect,
		onTestFinished,
	}) => {
		expect.hasAssertions();

		freezeDate(onTestFinished, "2026-10-27T15:30:00.000Z");
		const httpClient = freeQuota(1);
		const store = fakeStateStore();
		const result = await deploy({
			config: {
				badges: {
					"first-win": FIRST_WIN,
					"second-win": { ...FIRST_WIN, name: "Second Win" },
				},
				environments: { production: {} },
				passes: { vip: { name: "VIP", description: "Perks", icon: FIRST_WIN.icon } },
			},
			environment: "production",
			readFile: readIconAsync,
			registry: registry(httpClient),
			statePort: store.port,
		});

		expect(result).toStrictEqual({
			err: {
				available: 1,
				kind: "badgeQuotaExceeded",
				needed: 2,
				resetsAt: new Date("2026-10-28T00:00:00.000Z"),
			},
			success: false,
		});
		expect(requestLines(httpClient)).toStrictEqual([["GET", QUOTA_URL]]);
		expect(store.writes).toBeEmpty();
	});

	it("should publish without reading the free quota while badge creates are pending", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const httpClient = createFakeHttpClient();
		const result = await publish({
			config: CONFIG,
			environment: "production",
			readFile: readIconAsync,
			registry: registry(httpClient),
			statePort: fakeStateStore().port,
		});

		expect(result.success).toBeTrue();
		expect(httpClient.requests).toBeEmpty();
	});

	it("should create badges that use up the whole free quota", async ({ expect }) => {
		expect.hasAssertions();

		const httpClient = createdBadge(freeQuota(1));
		const result = await deploy({
			config: CONFIG,
			environment: "production",
			readFile: readIconAsync,
			registry: registry(httpClient),
			statePort: fakeStateStore().port,
		});

		assert(result.success);

		expect(requestLines(httpClient)).toStrictEqual([
			["GET", QUOTA_URL],
			["POST", CREATE_URL],
		]);
	});

	it("should fail a create Roblox refuses for cost after the check while an earlier create keeps its state", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const httpClient = createdBadge(freeQuota(2)).mockError(
			new ApiError("HTTP 403", {
				code: "18",
				details: { errors: [{ code: 18, message: "Expected badge cost is different." }] },
				statusCode: 403,
			}),
		);
		const store = fakeStateStore();
		const result = await deploy({
			config: {
				badges: {
					"first-win": FIRST_WIN,
					"second-win": { ...FIRST_WIN, name: "Second Win" },
				},
				environments: { production: {} },
			},
			environment: "production",
			readFile: readIconAsync,
			registry: registry(httpClient),
			statePort: store.port,
		});

		assert(!result.success);
		assert(result.err.kind === "applyFailed");

		const [failure, ...rest] = result.err.cause.failures;
		assert("cause" in failure);

		expect(rest).toBeEmpty();
		expect(failure.key).toBe("second-win");
		expect(failure.cause).toBeInstanceOf(BadgeCostMismatchError);
		expect(store.states.get("production")!.resources).toMatchObject([
			{ key: "first-win", outputs: { badgeId: "2468013579" } },
		]);
	});

	it("should refuse a deploy whose free quota read still fails after retries", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const httpClient = createFakeHttpClient();
		for (let attempt = 0; attempt < 4; attempt++) {
			httpClient.mockError(
				new NetworkError("socket reset", {
					cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
				}),
			);
		}

		const store = fakeStateStore();
		const result = await deploy({
			config: CONFIG,
			environment: "production",
			readFile: readIconAsync,
			registry: registry(httpClient),
			statePort: store.port,
		});

		assert(!result.success);

		expect(result.err).toMatchObject({
			available: undefined,
			kind: "badgeQuotaExceeded",
			needed: 1,
		});

		assert(result.err.kind === "badgeQuotaExceeded");

		expect(result.err.cause).toBeInstanceOf(NetworkError);
		expect(requestLines(httpClient)).toStrictEqual(
			Array.from({ length: 4 }, () => ["GET", QUOTA_URL]),
		);
		expect(store.writes).toBeEmpty();
	});

	it("should refuse an orphan before reading the free quota for a badge create", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const httpClient = createFakeHttpClient();
		const result = await deploy({
			config: CONFIG,
			environment: "production",
			readFile: readIconAsync,
			registry: registry(httpClient),
			statePort: fakeStateStore({
				initial: {
					production: {
						environment: "production",
						resources: [gamePassCurrent()],
						version: 1,
					},
				},
			}).port,
		});

		expect(result).toMatchObject({
			err: { cause: { kind: "orphanRejected" }, kind: "buildDesiredFailed" },
			success: false,
		});
		expect(httpClient.requests).toBeEmpty();
	});

	it("should refuse badge creates when the badge driver cannot read the free quota", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const result = await deploy({
			config: CONFIG,
			environment: "production",
			readFile: readIconAsync,
			registry: { ...registry(createFakeHttpClient()), badge: trap },
			statePort: fakeStateStore().port,
		});

		expect(result).toMatchObject({
			err: { available: undefined, kind: "badgeQuotaExceeded", needed: 1 },
			success: false,
		});

		assert(!result.success);

		expect(result.err).not.toHaveProperty("cause");
	});

	it("should refuse an overlay-only badge that has no name", async ({ expect }) => {
		expect.hasAssertions();

		const result = await deploy({
			config: {
				environments: { production: { badges: { "first-win": { description: "x" } } } },
			},
			environment: "production",
			readFile: readIconAsync,
			registry: registry(createFakeHttpClient()),
			statePort: fakeStateStore().port,
		});

		expect(result).toStrictEqual({
			err: {
				key: "first-win",
				environment: "production",
				kind: "incompleteBadgeEntry",
				missingField: "name",
			},
			success: false,
		});
	});

	it.for([
		{ field: "description", overlay: { name: "First Win", icon: FIRST_WIN.icon } },
		{ field: "icon", overlay: { name: "First Win", description: "x" } },
	])(
		"should refuse an overlay-only badge missing its $field",
		async ({ field, overlay }, { expect }) => {
			expect.hasAssertions();

			const result = await deploy({
				config: { environments: { production: { badges: { "first-win": overlay } } } },
				environment: "production",
				readFile: readIconAsync,
				registry: registry(createFakeHttpClient()),
				statePort: fakeStateStore().port,
			});

			expect(result).toMatchObject({
				err: { kind: "incompleteBadgeEntry", missingField: field },
				success: false,
			});
		},
	);

	it("should rename, clear, disable and re-icon a retired badge, then drop its state", async ({
		expect,
		onTestFinished,
	}) => {
		expect.hasAssertions();

		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-10-26T12:34:56.123Z"));
		onTestFinished(() => {
			vi.useRealTimers();
		});
		const httpClient = createFakeHttpClient()
			.mockResponse({ status: 200 })
			.mockResponse({ body: { targetId: 99 }, status: 200 });
		const store = trackedStore();
		const result = await deploy({
			config: {
				badges: { "first-win": { retired: true } },
				environments: { production: {} },
			},
			environment: "production",
			readFile: noFilesAsync,
			registry: registry(httpClient),
			statePort: store.port,
		});

		expect(result).toMatchObject({ success: true });
		expect(store.states.get("production")!.resources).toBeEmpty();
		expect(
			httpClient.requests.map(({ request }) => [request.method, request.url]),
		).toStrictEqual([
			["PATCH", "/legacy-badges/v1/badges/2468013579"],
			["POST", "/legacy-publish/v1/badges/2468013579/icon"],
		]);
		expect(httpClient.requests[0]!.request.body).toStrictEqual({
			name: "zzz_DEPRECATED(2026-10-26 12:34:56.123)",
			description: "",
			enabled: false,
		});

		const { body } = httpClient.requests[1]!.request;
		assert(body instanceof FormData);
		const icon = body.get("Files");
		assert(icon instanceof Blob);

		expect(new Uint8Array(await icon.arrayBuffer())).toStrictEqual(
			new Uint8Array(REDACTED_ICON_BYTES),
		);
	});

	it("should keep a badge's state when its retirement fails and converge on the next deploy", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const config = {
			badges: { "first-win": { retired: true } },
			environments: { production: {} },
		} satisfies Config;
		const store = trackedStore();
		const refusing = createFakeHttpClient().mockApiError({ code: "INTERNAL", statusCode: 400 });
		const failed = await deploy({
			config,
			environment: "production",
			readFile: noFilesAsync,
			registry: registry(refusing),
			statePort: store.port,
		});

		expect(failed).toMatchObject({ success: false });
		expect(refusing.requests).toHaveLength(1);
		expect(store.states.get("production")!.resources).toMatchObject([{ key: "first-win" }]);

		const retried = await deploy({
			config,
			environment: "production",
			readFile: noFilesAsync,
			registry: registry(
				createFakeHttpClient()
					.mockResponse({ status: 200 })
					.mockResponse({ body: { targetId: 99 }, status: 200 }),
			),
			statePort: store.port,
		});

		expect(retried).toMatchObject({ success: true });
		expect(store.states.get("production")!.resources).toBeEmpty();
	});

	it("should drop an untracked badge's state without any request", async ({ expect }) => {
		expect.hasAssertions();

		const httpClient = createFakeHttpClient();
		const store = trackedStore();
		const result = await deploy({
			config: {
				badges: { "first-win": { retired: "untrack" } },
				environments: { production: {} },
			},
			environment: "production",
			readFile: noFilesAsync,
			registry: registry(httpClient),
			statePort: store.port,
		});

		expect(result).toMatchObject({ success: true });
		expect(httpClient.requests).toBeEmpty();
		expect(store.states.get("production")!.resources).toBeEmpty();
	});

	it("should retire an orphaned badge under the retire orphan policy", async ({ expect }) => {
		expect.hasAssertions();

		const httpClient = createFakeHttpClient()
			.mockResponse({ status: 200 })
			.mockResponse({ body: { targetId: 99 }, status: 200 });
		const store = trackedStore();
		const result = await deploy({
			config: { environments: { production: {} }, orphans: "retire" },
			environment: "production",
			readFile: noFilesAsync,
			registry: registry(httpClient),
			statePort: store.port,
		});

		expect(result).toMatchObject({ success: true });
		expect(httpClient.requests.map(({ request }) => request.method)).toStrictEqual([
			"PATCH",
			"POST",
		]);
		expect(store.states.get("production")!.resources).toBeEmpty();
	});

	it("should name an orphaned badge in the orphan refusal by default", async ({ expect }) => {
		expect.hasAssertions();

		const httpClient = createFakeHttpClient();
		const store = trackedStore();
		const result = await deploy({
			config: { environments: { production: {} } },
			environment: "production",
			readFile: noFilesAsync,
			registry: registry(httpClient),
			statePort: store.port,
		});

		expect(result).toMatchObject({
			err: {
				cause: { kind: "orphanRejected", orphans: [{ key: "first-win", kind: "badge" }] },
				kind: "buildDesiredFailed",
			},
			success: false,
		});
		expect(httpClient.requests).toBeEmpty();
		expect(store.writes).toBeEmpty();
	});

	it("should rebind a badge moved to a new key without a create", async ({ expect }) => {
		expect.hasAssertions();

		const store = fakeStateStore();
		const created = await deploy({
			config: CONFIG,
			environment: "production",
			readFile: readIconAsync,
			registry: registry(createdBadge()),
			statePort: store.port,
		});

		assert(created.success);

		const httpClient = createFakeHttpClient();
		const result = await deploy({
			config: {
				badges: { "opening-win": { ...FIRST_WIN, movedFrom: "first-win" } },
				environments: { production: {} },
			},
			environment: "production",
			readFile: readIconAsync,
			registry: registry(httpClient),
			statePort: store.port,
		});

		expect(result).toMatchObject({ success: true });
		expect(httpClient.requests).toBeEmpty();
		expect(store.states.get("production")!.resources).toMatchObject([
			{ key: "opening-win", outputs: { badgeId: "2468013579" } },
		]);
	});
});
