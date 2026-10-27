import {
	asRobloxAssetId,
	type CodegenFile,
	type Config,
	createBadgeDriver,
	createClackProgressAdapter,
	deploy,
	type DriverRegistry,
	provision,
} from "@bedrock-rbx/core";
import { BadgesClient } from "@bedrock-rbx/ocale/badges";
import {
	createFakeHttpClient,
	type FakeHttpClient,
	validBadgeBody,
} from "@bedrock-rbx/ocale/testing";

import { assert, describe, it } from "vitest";

import { diffCommand } from "#src/cli/commands/diff";
import { EMPTY_PLUGIN_REGISTRY } from "#src/core/plugin-registry";
import { previewDiffAsync } from "#src/shell/preview-diff";
import { fakeClackPort } from "#tests/helpers/clack";
import { makeDeps } from "#tests/helpers/reconcile-command";
import { badgeCurrent } from "#tests/helpers/resources";
import { fakeStateStore } from "#tests/helpers/state-store";

const ICON_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x01]);
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

function createdBadge(): FakeHttpClient {
	return createFakeHttpClient().mockResponse({
		body: validBadgeBody({ id: 2_468_013_579, iconImageId: 1_357_924_680 }),
		status: 200,
	});
}

function formFields(body: FormData): Record<string, Blob | string> {
	return Object.fromEntries(Array.from(body.keys(), (key) => [key, body.get(key)!]));
}

function sentFields(httpClient: FakeHttpClient): Record<string, Blob | string> {
	const { body } = httpClient.requests[0]!.request;
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

		expect(
			httpClient.requests.map(({ request }) => [request.method, request.url]),
		).toStrictEqual([["POST", `/legacy-badges/v1/universes/${UNIVERSE_ID}/badges`]]);

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
					statePort: fakeStateStore().port,
				});
			},
		});
		await diffCommand(deps)({ env: "production" });

		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(0);
		expect(deps.clack!.logMessage).toHaveBeenCalledWith("+ badge:first-win First Win");
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

	it.for([
		{ config: { badges: { "first-win": { retired: true } } }, label: "retired" },
		{ config: { badges: { "first-win": { retired: "untrack" } } }, label: "untracked" },
	] as const)(
		"should refuse a $label badge before any request",
		async ({ config }, { expect }) => {
			expect.hasAssertions();

			const httpClient = createFakeHttpClient();
			const store = fakeStateStore({
				initial: {
					production: {
						environment: "production",
						resources: [badgeCurrent()],
						version: 1,
					},
				},
			});
			const result = await deploy({
				config: { ...config, environments: { production: {} } },
				environment: "production",
				readFile: readIconAsync,
				registry: registry(httpClient),
				statePort: store.port,
			});

			expect(result).toStrictEqual({
				err: {
					cause: {
						key: "first-win",
						kind: "retirementRejected",
						message: "Badge retirement is not available at this time.",
					},
					kind: "buildDesiredFailed",
				},
				success: false,
			});
			expect(httpClient.requests).toBeEmpty();
			expect(store.writes).toBeEmpty();
		},
	);

	it.for([
		{ config: { environments: { production: {} } }, refusal: "orphanRejected" },
		{
			config: { environments: { production: {} }, orphans: "retire" },
			refusal: "retirementRejected",
		},
	] as const)(
		"should refuse an orphaned badge as $refusal before any request",
		async ({ config, refusal }, { expect }) => {
			expect.hasAssertions();

			const httpClient = createFakeHttpClient();
			const store = fakeStateStore({
				initial: {
					production: {
						environment: "production",
						resources: [badgeCurrent()],
						version: 1,
					},
				},
			});
			const result = await deploy({
				config,
				environment: "production",
				readFile: readIconAsync,
				registry: registry(httpClient),
				statePort: store.port,
			});

			expect(result).toMatchObject({
				err: { cause: { kind: refusal }, kind: "buildDesiredFailed" },
				success: false,
			});
			expect(httpClient.requests).toBeEmpty();
			expect(store.writes).toBeEmpty();
		},
	);
});
