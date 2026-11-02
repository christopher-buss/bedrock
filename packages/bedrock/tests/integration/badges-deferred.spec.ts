import {
	asRobloxAssetId,
	type CodegenFile,
	type Config,
	createBadgeDriver,
	createClackProgressAdapter,
	deploy,
	type DriverRegistry,
	type ProgressEvent,
	provision,
	type StateError,
} from "@bedrock-rbx/core";
import { ApiError, BadgeCostMismatchError } from "@bedrock-rbx/ocale";
import { BadgesClient } from "@bedrock-rbx/ocale/badges";
import {
	createFakeHttpClient,
	type FakeHttpClient,
	validBadgeBody,
} from "@bedrock-rbx/ocale/testing";

import { assert, describe, it, vi } from "vitest";

import { diffCommand } from "#src/cli/commands/diff";
import { EMPTY_PLUGIN_REGISTRY } from "#src/core/plugin-registry";
import { previewDiffAsync } from "#src/shell/preview-diff";
import { fakeClackPort } from "#tests/helpers/clack";
import { makeDeps } from "#tests/helpers/reconcile-command";
import { universeCurrent } from "#tests/helpers/resources";
import { fakeStateLock } from "#tests/helpers/state-lock";
import { fakeStateStore } from "#tests/helpers/state-store";

const UNIVERSE_ID = asRobloxAssetId("1234567890");
const QUOTA_URL = `/v1/universes/${UNIVERSE_ID}/free-badges-quota`;
const CREATE_URL = `/legacy-badges/v1/universes/${UNIVERSE_ID}/badges`;
const ICON = { "en-us": "assets/badge.png" } as const;

const CONFIG = {
	badges: {
		alpha: { name: "Alpha", description: "First.", icon: ICON },
		beta: { name: "Beta", description: "Second.", icon: ICON },
		gamma: { name: "Gamma", description: "Third.", icon: ICON },
	},
	environments: { dev: { allowDeferredCreates: true } },
} satisfies Config;

const trap = {
	async create(): Promise<never> {
		throw new Error("Unexpected create");
	},
	async retire(): Promise<never> {
		throw new Error("Unexpected retire");
	},
};

async function readIconAsync(): Promise<Uint8Array> {
	return new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
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

function withQuota(left: number, created: ReadonlyArray<number>): FakeHttpClient {
	return created.reduce(
		(client, id) => {
			return client.mockResponse({
				body: validBadgeBody({ id, iconImageId: id + 1 }),
				status: 200,
			});
		},
		createFakeHttpClient().mockResponse({ body: left, status: 200 }),
	);
}

function postedNames(httpClient: FakeHttpClient): Array<unknown> {
	return httpClient.requests
		.filter(({ request }) => request.method === "POST")
		.map(({ request }) => {
			assert(request.body instanceof FormData);
			return request.body.get("name");
		});
}

function costRefusal(): ApiError {
	return new ApiError("HTTP 403", {
		code: "18",
		details: { errors: [{ code: 18, message: "Expected badge cost is different." }] },
		statusCode: 403,
	});
}

async function deployWithLateFailureAsync(failure: string, events: Array<ProgressEvent>) {
	const store = fakeStateStore();
	const stateError: StateError = {
		file: "state.json",
		kind: "stateError",
		reason: "EIO",
	};
	let built = false;
	return deploy({
		build: async () => {
			if (failure === "build") {
				throw new Error("Build failed");
			}

			built = true;
		},
		codegenWriter: { write: async () => ({ data: undefined, success: true }) },
		config: {
			...CONFIG,
			codegen: { enabled: true },
			environments: {
				dev: { allowDeferredCreates: true, places: { main: { placeId: "4711" } } },
			},
			places: { main: { filePath: "places/main.rbxl" } },
		},
		emit: () => {
			if (failure === "codegen") {
				throw new Error("Emitter failed");
			}

			return [];
		},
		environment: "dev",
		progress: {
			emit: (event) => {
				events.push(event);
			},
		},
		readFile: readIconAsync,
		registry: {
			...registry(withQuota(3, [111, 222]).mockError(costRefusal())),
			place: {
				create: async (desired) => {
					return {
						data: { ...desired, outputs: { versionNumber: 1 } },
						success: true,
					};
				},
				retire: trap.retire,
			},
		},
		statePort: {
			read: async (environment) => {
				if (built && failure === "publish read") {
					return { err: stateError, success: false };
				}

				return store.port.read(environment);
			},
			write: async (state, version) => {
				if (
					(!built && failure === "provision write") ||
					(built && failure === "publish write")
				) {
					return { err: stateError, success: false };
				}

				return store.port.write(state, version);
			},
		},
	});
}

describe("deferred badge creates", () => {
	it.for([
		{ failure: "codegen", kind: "codegenFailed" },
		{ failure: "build", kind: "buildFailed" },
		{ failure: "publish read", kind: "stateReadFailed" },
		{ failure: "provision write", kind: "stateWriteFailed" },
		{ failure: "publish write", kind: "stateWriteFailed" },
	] as const)(
		"should report deferred badges when $failure fails after a cost refusal",
		async ({ failure, kind }, { expect, onTestFinished }) => {
			expect.hasAssertions();

			vi.useFakeTimers({ now: new Date("2026-10-27T15:30:00.000Z"), toFake: ["Date"] });
			onTestFinished(() => {
				vi.useRealTimers();
			});
			const events: Array<ProgressEvent> = [];
			const result = await deployWithLateFailureAsync(failure, events);

			assert(!result.success);

			expect(result.err.deferredCreates).toStrictEqual([{ key: "gamma", kind: "badge" }]);
			expect(result).toMatchObject({
				err: { deferredCreates: [{ key: "gamma", kind: "badge" }], kind },
				success: false,
			});
			expect(events.filter((event) => event.kind === "badgeCreatesDeferred")).toStrictEqual([
				{
					deferred: [{ key: "gamma", kind: "badge" }],
					environment: "dev",
					kind: "badgeCreatesDeferred",
					resetsAt: new Date("2026-10-28T00:00:00.000Z"),
				},
			]);
			expect(events.at(-1)).toMatchObject({ error: result.err, kind: "deployFailure" });
		},
	);

	it("should create the badges the quota covers in key order and defer the rest", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const httpClient = withQuota(1, [111]);
		const store = fakeStateStore();
		const releaseError = { reason: "lock store unreachable" };
		const result = await deploy({
			config: CONFIG,
			environment: "dev",
			readFile: readIconAsync,
			registry: registry(httpClient),
			stateLockPort: fakeStateLock({ refuseRelease: releaseError }).port,
			statePort: store.port,
		});

		assert(result.success, JSON.stringify(result));

		expect(result.data.deferredCreates).toStrictEqual([
			{ key: "beta", kind: "badge" },
			{ key: "gamma", kind: "badge" },
		]);
		expect(httpClient.requests.map(({ request }) => request.url)).toStrictEqual([
			QUOTA_URL,
			CREATE_URL,
		]);
		expect(postedNames(httpClient)).toStrictEqual(["Alpha"]);
		expect(store.states.get("dev")!.resources.map(({ key }) => key)).toStrictEqual(["alpha"]);
		expect(result.data.lockReleaseError).toStrictEqual(releaseError);
	});

	it.for([
		{
			created: [111],
			line: '2 badge creates deferred in "dev", no free badge quota left today: beta, gamma; the free badge quota resets at 2026-10-28 00:00 UTC',
			quota: 1,
		},
		{
			created: [111, 222],
			line: '1 badge create deferred in "dev", no free badge quota left today: gamma; the free badge quota resets at 2026-10-28 00:00 UTC',
			quota: 2,
		},
	])(
		"should warn with the deferred keys and the next quota reset at quota $quota",
		async ({ created, line, quota }, { expect, onTestFinished }) => {
			expect.hasAssertions();

			vi.useFakeTimers({ now: new Date("2026-10-27T15:30:00.000Z"), toFake: ["Date"] });
			onTestFinished(() => {
				vi.useRealTimers();
			});
			const clack = fakeClackPort();
			const result = await deploy({
				config: CONFIG,
				environment: "dev",
				progress: createClackProgressAdapter({ clack }),
				readFile: readIconAsync,
				registry: registry(withQuota(quota, created)),
				statePort: fakeStateStore().port,
			});

			assert(result.success, JSON.stringify(result));

			expect(clack.logMessage).toHaveBeenCalledWith(line);
		},
	);

	it("should warn of the creates the quota deferred when another create fails", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const clack = fakeClackPort();
		const httpClient = createFakeHttpClient()
			.mockResponse({ body: 1, status: 200 })
			.mockError(new ApiError("HTTP 400", { statusCode: 400 }));
		const result = await deploy({
			config: CONFIG,
			environment: "dev",
			progress: createClackProgressAdapter({ clack }),
			readFile: readIconAsync,
			registry: registry(httpClient),
			statePort: fakeStateStore().port,
		});

		expect(result).toMatchObject({
			err: {
				deferredCreates: [
					{ key: "beta", kind: "badge" },
					{ key: "gamma", kind: "badge" },
				],
				kind: "applyFailed",
			},
			success: false,
		});
		expect(clack.logMessage).toHaveBeenCalledWith(
			expect.stringMatching(/^2 badge creates deferred in "dev"/),
		);
	});

	it("should create the deferred badges on the next deploy once the quota refreshes", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const store = fakeStateStore();
		await deploy({
			config: CONFIG,
			environment: "dev",
			readFile: readIconAsync,
			registry: registry(withQuota(1, [111])),
			statePort: store.port,
		});
		const httpClient = withQuota(2, [222, 333]);
		const result = await deploy({
			config: CONFIG,
			environment: "dev",
			readFile: readIconAsync,
			registry: registry(httpClient),
			statePort: store.port,
		});

		assert(result.success, JSON.stringify(result));

		expect(result.data).not.toHaveProperty("deferredCreates");
		expect(postedNames(httpClient)).toIncludeSameMembers(["Beta", "Gamma"]);
		expect(store.states.get("dev")!.resources.map(({ key }) => key)).toIncludeSameMembers([
			"alpha",
			"beta",
			"gamma",
		]);
	});

	it("should defer a create Roblox refuses for cost after the check", async ({ expect }) => {
		expect.hasAssertions();

		const httpClient = createFakeHttpClient()
			.mockResponse({ body: 2, status: 200 })
			.mockError(
				new ApiError("HTTP 403", {
					code: "18",
					details: {
						errors: [{ code: 18, message: "Expected badge cost is different." }],
					},
					statusCode: 403,
				}),
			)
			.mockResponse({ body: validBadgeBody({ id: 222, iconImageId: 223 }), status: 200 });
		const store = fakeStateStore();
		const result = await deploy({
			config: CONFIG,
			environment: "dev",
			readFile: readIconAsync,
			registry: registry(httpClient),
			statePort: store.port,
		});

		assert(result.success, JSON.stringify(result));

		expect(result.data.deferredCreates).toStrictEqual([
			{ key: "alpha", kind: "badge" },
			{ key: "gamma", kind: "badge" },
		]);
		expect(store.states.get("dev")!.resources.map(({ key }) => key)).toStrictEqual(["beta"]);
	});

	it("should fail a badge driver that throws a cost refusal instead of returning it", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const result = await deploy({
			config: CONFIG,
			environment: "dev",
			readFile: readIconAsync,
			registry: {
				...registry(createFakeHttpClient()),
				badge: {
					async create() {
						throw new BadgeCostMismatchError("Expected badge cost is different.", {
							code: "18",
							expectedCost: 0,
							statusCode: 403,
						});
					},
					async readCreateCapacity() {
						return { data: 3, success: true };
					},
					retire: trap.retire,
				},
			},
			statePort: fakeStateStore().port,
		});

		assert(!result.success);
		assert(result.err.kind === "applyFailed");

		expect(result.err.cause.failures.map(({ key, kind }) => [key, kind])).toStrictEqual([
			["alpha", "unexpectedThrow"],
			["beta", "unexpectedThrow"],
			["gamma", "unexpectedThrow"],
		]);
	});

	it("should fail the other creates Roblox refuses and still defer a cost refusal", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const clack = fakeClackPort();
		const releaseError = { reason: "lock store unreachable" };
		const httpClient = withQuota(3, [111])
			.mockError(new ApiError("HTTP 400", { statusCode: 400 }))
			.mockError(costRefusal());
		const result = await deploy({
			config: CONFIG,
			environment: "dev",
			progress: createClackProgressAdapter({ clack }),
			readFile: readIconAsync,
			registry: registry(httpClient),
			stateLockPort: fakeStateLock({ refuseRelease: releaseError }).port,
			statePort: fakeStateStore().port,
		});

		assert(!result.success);
		assert(result.err.kind === "applyFailed");

		expect(result.err.cause.failures.map(({ key }) => key)).toStrictEqual(["beta"]);
		expect(result.err.deferredCreates).toStrictEqual([{ key: "gamma", kind: "badge" }]);
		expect(result.err.lockReleaseError).toStrictEqual(releaseError);
		expect(clack.logMessage).toHaveBeenCalledWith(
			expect.stringMatching(/^1 badge create deferred in "dev".*: gamma;/),
		);
	});

	it("should defer a cost refusal under managed visibility and keep it out of state", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const store = fakeStateStore();
		const result = await deploy({
			config: { ...CONFIG, universe: { universeId: UNIVERSE_ID, visibility: "private" } },
			environment: "dev",
			readFile: readIconAsync,
			registry: {
				...registry(withQuota(3, [111, 222]).mockError(costRefusal())),
				universe: {
					async create(desired) {
						return {
							data: { ...desired, outputs: universeCurrent().outputs },
							success: true,
						};
					},
					retire: trap.retire,
					async setVisibility() {
						return { data: undefined, success: true };
					},
				},
			},
			statePort: store.port,
		});

		assert(result.success, JSON.stringify(result));

		expect(result.data.deferredCreates).toStrictEqual([{ key: "gamma", kind: "badge" }]);
		expect(JSON.stringify(store.states.get("dev"))).not.toContain("deferredCreates");
		expect(store.states.get("dev")).not.toHaveProperty("deferred");
	});

	it("should defer a create Roblox refuses for cost during provision", async ({ expect }) => {
		expect.hasAssertions();

		const store = fakeStateStore();
		const result = await provision({
			config: CONFIG,
			environment: "dev",
			readFile: readIconAsync,
			registry: registry(withQuota(3, [111, 222]).mockError(costRefusal())),
			statePort: store.port,
		});

		assert(result.success, JSON.stringify(result));

		expect(result.data.deferredCreates).toStrictEqual([{ key: "gamma", kind: "badge" }]);
		expect(JSON.stringify(store.states.get("dev"))).not.toContain("deferredCreates");
		expect(store.states.get("dev")).not.toHaveProperty("deferred");
	});

	it("should report a cost refusal as deferred, not failed, in progress output", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const clack = fakeClackPort();
		const httpClient = withQuota(3, [111, 222]).mockError(costRefusal());
		const result = await deploy({
			config: CONFIG,
			environment: "dev",
			progress: createClackProgressAdapter({ clack }),
			readFile: readIconAsync,
			registry: registry(httpClient),
			statePort: fakeStateStore().port,
		});

		assert(result.success, JSON.stringify(result));

		expect(clack.logError).not.toHaveBeenCalled();
		expect(clack.logMessage).toHaveBeenCalledWith(
			expect.stringMatching(/^Succeeded in .*: 2 create, 0 update, 0 noop, 0 failed$/),
		);
	});

	it("should leave deferred badges out of codegen", async ({ expect }) => {
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
			environment: "dev",
			readFile: readIconAsync,
			registry: registry(withQuota(1, [111])),
			statePort: fakeStateStore().port,
		});

		assert(result.success, JSON.stringify(result));

		const content = writes.map((file) => file.content).join("\n");

		expect(content).toContain("alpha = {");
		expect(content).not.toContain("beta");
		expect(content).not.toContain("gamma");
	});

	it("should label each badge create the quota leaves for a later deploy in the diff", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const deps = makeDeps({
			loadProject: async () => {
				return { data: { config: CONFIG, plugins: EMPTY_PLUGIN_REGISTRY }, success: true };
			},
			previewDiff: async (input) => {
				return previewDiffAsync({
					...input,
					readFile: readIconAsync,
					readFreeBadgeQuota: async () => ({ data: 1, success: true }),
					statePort: fakeStateStore().port,
				});
			},
		});
		await diffCommand(deps)({ env: "dev" });

		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(0);
		expect(vi.mocked(deps.clack!.logMessage).mock.calls.flat()).toStrictEqual([
			'Pending changes for "dev":',
			"+ badge:alpha Alpha",
			"+ badge:beta Beta create (deferred: no free badge quota)",
			"+ badge:gamma Gamma create (deferred: no free badge quota)",
		]);
	});
});
