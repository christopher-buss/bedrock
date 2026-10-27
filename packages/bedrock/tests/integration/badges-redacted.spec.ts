import {
	asRobloxAssetId,
	type Config,
	createBadgeDriver,
	deploy,
	type DriverRegistry,
} from "@bedrock-rbx/core";
import { BadgesClient } from "@bedrock-rbx/ocale/badges";
import {
	createFakeHttpClient,
	type FakeHttpClient,
	validBadgeBody,
} from "@bedrock-rbx/ocale/testing";

import { assert, describe, it } from "vitest";

import { REDACTED_ICON_BYTES } from "#src/core/redacted-icon";
import { fakeStateStore } from "#tests/helpers/state-store";

const REAL_ICON_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x01]);
const BETA_ICON_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x02]);
const UNIVERSE_ID = asRobloxAssetId("1234567890");
const FIRST_WIN = {
	name: "First Win",
	description: "Win your first round.",
	icon: { "en-us": "assets/first-win.png" },
} as const;

const trap = {
	async create(): Promise<never> {
		throw new Error("Unexpected create");
	},
	async retire(): Promise<never> {
		throw new Error("Unexpected retire");
	},
};

interface SentBadge {
	readonly name: unknown;
	readonly description: unknown;
	readonly icon: Uint8Array;
}

async function readIconAsync(path: string): Promise<Uint8Array> {
	if (path === "assets/first-win.png") {
		return REAL_ICON_BYTES;
	}

	if (path === "assets/beta.png") {
		return BETA_ICON_BYTES;
	}

	throw new Error(`Unexpected read of ${path}`);
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

async function deployBadgeAsync(config: Config): Promise<SentBadge> {
	const httpClient = createFakeHttpClient().mockResponse({
		body: validBadgeBody({ id: 2_468_013_579, iconImageId: 1_357_924_680 }),
		status: 200,
	});
	const result = await deploy({
		config,
		environment: "beta",
		readFile: readIconAsync,
		registry: registry(httpClient),
		statePort: fakeStateStore().port,
	});

	assert(result.success);

	const { body } = httpClient.requests[0]!.request;
	assert(body instanceof FormData);
	const files = body.get("files");
	assert(files instanceof Blob);

	return {
		name: body.get("name"),
		description: body.get("description"),
		icon: new Uint8Array(await files.arrayBuffer()),
	};
}

const PLACEHOLDER = {
	name: "Redacted Badge",
	description: "",
	icon: new Uint8Array(REDACTED_ICON_BYTES),
};

describe("redacted badges", () => {
	it.for<{ config: Config; label: string }>([
		{
			config: {
				badges: { "first-win": { ...FIRST_WIN, redacted: true } },
				environments: { beta: {} },
			},
			label: "the badge",
		},
		{
			config: {
				badges: { "first-win": FIRST_WIN },
				environments: { beta: { redacted: true } },
			},
			label: "its environment",
		},
	])(
		"should send the placeholder name, description and icon when $label is redacted",
		async ({ config }, { expect }) => {
			expect.hasAssertions();

			await expect(deployBadgeAsync(config)).resolves.toStrictEqual(PLACEHOLDER);
		},
	);

	it("should send the real badge when it opts out of environment redaction", async ({
		expect,
	}) => {
		expect.hasAssertions();

		await expect(
			deployBadgeAsync({
				badges: { "first-win": { ...FIRST_WIN, redacted: false } },
				environments: { beta: { redacted: true } },
			}),
		).resolves.toStrictEqual({
			name: "First Win",
			description: "Win your first round.",
			icon: REAL_ICON_BYTES,
		});
	});

	it("should take environment-level override fields over the badge placeholders", async ({
		expect,
	}) => {
		expect.hasAssertions();

		await expect(
			deployBadgeAsync({
				badges: { "first-win": FIRST_WIN },
				environments: {
					beta: {
						redacted: { name: "Beta Reward", icon: { "en-us": "assets/beta.png" } },
					},
				},
			}),
		).resolves.toStrictEqual({ ...PLACEHOLDER, name: "Beta Reward", icon: BETA_ICON_BYTES });
	});

	it("should take the badge's override fields over the environment-level override", async ({
		expect,
	}) => {
		expect.hasAssertions();

		await expect(
			deployBadgeAsync({
				badges: {
					"first-win": {
						...FIRST_WIN,
						redacted: { name: "Mystery Reward", description: "Coming soon." },
					},
				},
				environments: { beta: { redacted: { name: "Beta Reward" } } },
			}),
		).resolves.toStrictEqual({
			...PLACEHOLDER,
			name: "Mystery Reward",
			description: "Coming soon.",
		});
	});

	it.for<{ expected: SentBadge; label: string; overlay: boolean | { name: string } }>([
		{ expected: PLACEHOLDER, label: "true", overlay: true },
		{
			expected: { ...PLACEHOLDER, name: "Mystery Reward" },
			label: "an override",
			overlay: { name: "Mystery Reward" },
		},
	])(
		"should redact a badge whose environment overlay sets redacted to $label",
		async ({ expected, overlay }, { expect }) => {
			expect.hasAssertions();

			await expect(
				deployBadgeAsync({
					badges: { "first-win": FIRST_WIN },
					environments: { beta: { badges: { "first-win": { redacted: overlay } } } },
				}),
			).resolves.toStrictEqual(expected);
		},
	);

	it("should compose a badge's overlay override field by field with its root override", async ({
		expect,
	}) => {
		expect.hasAssertions();

		await expect(
			deployBadgeAsync({
				badges: { "first-win": { ...FIRST_WIN, redacted: { name: "Mystery Reward" } } },
				environments: {
					beta: {
						badges: { "first-win": { redacted: { description: "Coming soon." } } },
					},
				},
			}),
		).resolves.toStrictEqual({
			...PLACEHOLDER,
			name: "Mystery Reward",
			description: "Coming soon.",
		});
	});

	it("should keep a badge real when its overlay opts out of redaction", async ({ expect }) => {
		expect.hasAssertions();

		await expect(
			deployBadgeAsync({
				badges: { "first-win": { ...FIRST_WIN, redacted: true } },
				environments: { beta: { badges: { "first-win": { redacted: false } } } },
			}),
		).resolves.toStrictEqual({
			name: "First Win",
			description: "Win your first round.",
			icon: REAL_ICON_BYTES,
		});
	});
});
