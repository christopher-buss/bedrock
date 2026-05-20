import { assert, describe, expect, it, vi } from "vitest";

import type { Config } from "../core/schema.ts";
import type { BedrockState, StateError } from "../core/state.ts";
import type { StatePort } from "../ports/state-port.ts";
import { asResourceKey, asRobloxAssetId, asSha256Hex } from "../types/ids.ts";
import { previewDiff, type PreviewDiffOptions } from "./preview-diff.ts";

type LoadConfigFunc = NonNullable<PreviewDiffOptions["loadConfig"]>;
type ReadFileFunc = NonNullable<PreviewDiffOptions["readFile"]>;

const ICON_BYTES = new Uint8Array();
const ICON_HASH = asSha256Hex("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");

async function readIcon(): Promise<Uint8Array> {
	return ICON_BYTES;
}

function inMemoryStatePort(initial?: BedrockState): {
	port: StatePort;
	writes: Array<BedrockState>;
} {
	const writes: Array<BedrockState> = [];
	return {
		port: {
			async read() {
				return { data: initial, success: true };
			},
			async write(state) {
				writes.push(state);
				return { data: undefined, success: true };
			},
		},
		writes,
	};
}

function vipPassConfig(): Config {
	return {
		environments: { production: {} },
		passes: {
			"vip-pass": {
				name: "VIP Pass",
				description: "Grants VIP perks.",
				icon: { "en-us": "assets/vip-icon.png" },
				price: 500,
			},
		},
	};
}

function vipPassCurrent() {
	return {
		key: asResourceKey("vip-pass"),
		name: "VIP Pass",
		description: "Grants VIP perks.",
		icon: { "en-us": "assets/vip-icon.png" },
		iconFileHashes: { "en-us": ICON_HASH },
		kind: "gamePass" as const,
		outputs: {
			assetId: asRobloxAssetId("9876543210"),
			iconAssetIds: { "en-us": asRobloxAssetId("1122334455") },
		},
		price: 500,
	};
}

describe(previewDiff, () => {
	it("should compute create ops against empty prior state without writing", async () => {
		expect.assertions(4);

		const { port, writes } = inMemoryStatePort();

		const result = await previewDiff({
			config: vipPassConfig(),
			environment: "production",
			readFile: readIcon,
			statePort: port,
		});

		assert(result.success);

		expect(result.data.environment).toBe("production");
		expect(result.data.ops).toHaveLength(1);
		expect(result.data.ops[0]).toMatchObject({
			key: "vip-pass",
			type: "create",
		});
		expect(writes).toBeEmpty();
	});

	it("should compute noop ops when desired matches current state without writing", async () => {
		expect.assertions(3);

		const existing = vipPassCurrent();
		const { port, writes } = inMemoryStatePort({
			environment: "production",
			resources: [existing],
			version: 1,
		});

		const result = await previewDiff({
			config: vipPassConfig(),
			environment: "production",
			readFile: readIcon,
			statePort: port,
		});

		assert(result.success);

		expect(result.data.ops).toHaveLength(1);
		expect(result.data.ops[0]).toMatchObject({ key: "vip-pass", type: "noop" });
		expect(writes).toBeEmpty();
	});

	it("should compute update ops when a desired field differs from current", async () => {
		expect.assertions(2);

		const { port, writes } = inMemoryStatePort({
			environment: "production",
			resources: [{ ...vipPassCurrent(), price: 250 }],
			version: 1,
		});

		const result = await previewDiff({
			config: vipPassConfig(),
			environment: "production",
			readFile: readIcon,
			statePort: port,
		});

		assert(result.success);

		expect(result.data.ops[0]).toMatchObject({ key: "vip-pass", type: "update" });
		expect(writes).toBeEmpty();
	});

	it("should call loadConfig and surface configLoadFailed when omitted config and loader returns Err", async () => {
		expect.assertions(2);

		const loadConfig = vi.fn<LoadConfigFunc>(async () => {
			return {
				err: { kind: "fileNotFound", searchedFrom: "/tmp" },
				success: false,
			};
		});

		const result = await previewDiff({
			environment: "production",
			loadConfig,
		});

		expect(loadConfig).toHaveBeenCalledOnce();

		assert(!result.success);

		expect(result.err).toStrictEqual({
			cause: { kind: "fileNotFound", searchedFrom: "/tmp" },
			kind: "configLoadFailed",
		});
	});

	it("should surface unknownEnvironment when the env is not declared in config", async () => {
		expect.assertions(1);

		const { port } = inMemoryStatePort();

		const result = await previewDiff({
			config: vipPassConfig(),
			environment: "ghost",
			readFile: readIcon,
			statePort: port,
		});

		assert(!result.success);

		expect(result.err).toStrictEqual({
			declared: ["production"],
			environment: "ghost",
			kind: "unknownEnvironment",
		});
	});

	it("should surface incompletePlaceEntry when a place is missing placeId", async () => {
		expect.assertions(1);

		const config: Config = {
			environments: { production: {} },
			places: {
				"start-place": { filePath: "places/start.rbxl" },
			},
		};
		const { port } = inMemoryStatePort();

		const result = await previewDiff({
			config,
			environment: "production",
			readFile: readIcon,
			statePort: port,
		});

		assert(!result.success);

		expect(result.err).toMatchObject({
			key: "start-place",
			environment: "production",
			kind: "incompletePlaceEntry",
			missingField: "placeId",
		});
	});

	it("should surface stateNotConfigured when no statePort is provided and config has no state", async () => {
		expect.assertions(1);

		const result = await previewDiff({
			config: vipPassConfig(),
			environment: "production",
			readFile: readIcon,
		});

		assert(!result.success);

		expect(result.err).toStrictEqual({
			environment: "production",
			kind: "stateNotConfigured",
		});
	});

	it("should surface missingCredential when buildStatePort cannot read BEDROCK_GITHUB_TOKEN", async () => {
		expect.assertions(1);

		const config: Config = {
			...vipPassConfig(),
			state: { backend: "gist", gistId: "abc-test" },
		};

		const result = await previewDiff({
			config,
			environment: "production",
			getEnv: () => {},
			readFile: readIcon,
		});

		assert(!result.success);

		expect(result.err).toStrictEqual({
			kind: "missingCredential",
			purpose: "stateBackend",
			variable: "BEDROCK_GITHUB_TOKEN",
		});
	});

	it("should surface unsupportedBackend when state.backend is not recognized", async () => {
		expect.assertions(1);

		const config: Config = {
			...vipPassConfig(),
			state: { backend: "s3" },
		};

		const result = await previewDiff({
			config,
			environment: "production",
			getEnv: () => "ghp_test",
			readFile: readIcon,
		});

		assert(!result.success);

		expect(result.err).toMatchObject({
			backend: "s3",
			kind: "unsupportedBackend",
		});
	});

	it("should surface buildDesiredFailed with iconRemovalRejected when prior state recorded a developer-product icon dropped from config", async () => {
		expect.assertions(3);

		const priorProduct = {
			key: asResourceKey("gem-pack"),
			name: "Gem Pack",
			description: "Stocks the player up with 1,000 premium gems.",
			icon: { "en-us": "assets/gem-pack.png" },
			iconFileHashes: { "en-us": ICON_HASH },
			isRegionalPricingEnabled: undefined,
			kind: "developerProduct" as const,
			outputs: { productId: asRobloxAssetId("8172635495") },
			price: undefined,
			storePageEnabled: undefined,
		};
		const { port } = inMemoryStatePort({
			environment: "production",
			resources: [priorProduct],
			version: 1,
		});

		const result = await previewDiff({
			config: {
				environments: { production: {} },
				products: {
					"gem-pack": {
						name: "Gem Pack",
						description: "Stocks the player up with 1,000 premium gems.",
					},
				},
			},
			environment: "production",
			readFile: readIcon,
			statePort: port,
		});

		assert(!result.success);
		assert(result.err.kind === "buildDesiredFailed");
		assert(result.err.cause.kind === "iconRemovalRejected");

		expect(result.err.cause.key).toBe(priorProduct.key);
		expect(result.err.cause.message).toContain(priorProduct.key);
		expect(result.err.cause.message).toContain("icon");
	});

	it("should surface buildDesiredFailed when readFile rejects", async () => {
		expect.assertions(1);

		const { port } = inMemoryStatePort();
		const readFile = vi.fn<ReadFileFunc>(async () => {
			throw new Error("ENOENT");
		});

		const result = await previewDiff({
			config: vipPassConfig(),
			environment: "production",
			readFile,
			statePort: port,
		});

		assert(!result.success);

		expect(result.err).toMatchObject({ kind: "buildDesiredFailed" });
	});

	it("should surface stateReadFailed when statePort.read returns Err without writing", async () => {
		expect.assertions(2);

		const stateError: StateError = {
			file: ".bedrock/state/production.json",
			kind: "stateError",
			reason: "Corrupt JSON",
		};
		const writes: Array<BedrockState> = [];
		const port: StatePort = {
			async read() {
				return { err: stateError, success: false };
			},
			async write(state) {
				writes.push(state);
				return { data: undefined, success: true };
			},
		};

		const result = await previewDiff({
			config: vipPassConfig(),
			environment: "production",
			readFile: readIcon,
			statePort: port,
		});

		assert(!result.success);

		expect(result.err).toStrictEqual({ cause: stateError, kind: "stateReadFailed" });
		expect(writes).toBeEmpty();
	});

	it("should default-construct loadConfig and statePort when neither is supplied", async () => {
		expect.assertions(1);

		const config: Config = {
			...vipPassConfig(),
			state: { backend: "gist", gistId: "abc-test" },
		};
		const loadConfig = vi.fn<LoadConfigFunc>(async () => ({ data: config, success: true }));

		const result = await previewDiff({
			environment: "production",
			fetch: async () => new Response(JSON.stringify({ files: {} }), { status: 200 }),
			getEnv: (name) => (name === "BEDROCK_GITHUB_TOKEN" ? "ghp_test" : undefined),
			loadConfig,
			readFile: readIcon,
		});

		expect(loadConfig).toHaveBeenCalledOnce();

		assert(result.success);
	});

	it("should return an empty redactions array when no pass is flagged redacted", async () => {
		expect.assertions(1);

		const { port } = inMemoryStatePort();

		const result = await previewDiff({
			config: vipPassConfig(),
			environment: "production",
			readFile: readIcon,
			statePort: port,
		});

		assert(result.success);

		expect(result.data.redactions).toStrictEqual([]);
	});

	it("should return a redaction annotation with hasRealValueEdits true when the redacted pass keeps its real name in config", async () => {
		expect.assertions(1);

		const config: Config = {
			environments: { production: {} },
			passes: {
				"vip-pass": {
					name: "VIP Pass",
					description: "Grants VIP perks.",
					icon: { "en-us": "assets/vip-icon.png" },
					price: 500,
					redacted: true,
				},
			},
		};
		const { port } = inMemoryStatePort();

		const result = await previewDiff({
			config,
			environment: "production",
			readFile: readIcon,
			statePort: port,
		});

		assert(result.success);

		expect(result.data.redactions).toStrictEqual([
			{ key: "vip-pass", hasRealValueEdits: true, kind: "gamePass" },
		]);
	});
});
