import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { assert, describe, it, vi } from "vitest";

import { BADGE_TRAP } from "#tests/helpers/drivers";
import { EMPTY_PLUGIN_REGISTRY } from "../../src/core/plugin-registry.ts";
import { asRobloxAssetId, deploy } from "../../src/index.ts";
import type { StatePort } from "../../src/index.ts";
import { previewDiffAsync as previewDiff } from "../../src/shell/preview-diff.ts";
import { environmentFrom } from "../helpers/environment.ts";
import { captureStreams } from "../helpers/streams.ts";

const emptyState: StatePort = {
	async read() {
		return { data: { state: undefined }, success: true };
	},
	async write() {
		throw new Error("empty preview or failed deploy must not write");
	},
};

const trapDriver = {
	async create(): Promise<never> {
		throw new Error("unexpected resource creation");
	},
	async retire(): Promise<never> {
		throw new Error("unexpected retirement");
	},
};

describe("project discovery at reconciliation entrypoints", () => {
	it.for([
		{ label: "loaded", options: {} },
		{ label: "explicit", options: { plugins: EMPTY_PLUGIN_REGISTRY } },
	] as const)(
		"should discover config and preview without credentials with $label plugins",
		async ({ options }, { expect, onTestFinished }) => {
			expect.assertions(1);

			const cwd = mkdtempSync(join(tmpdir(), "bedrock-preview-project-"));
			onTestFinished(() => {
				rmSync(cwd, { force: true, recursive: true });
			});
			writeFileSync(
				join(cwd, "bedrock.config.json"),
				JSON.stringify({ environments: { production: {} } }),
			);
			vi.spyOn(process, "cwd").mockReturnValue(cwd);
			onTestFinished(() => {
				vi.restoreAllMocks();
			});
			const result = await previewDiff({
				environment: "production",
				...options,
				statePort: emptyState,
			});
			assert(result.success);

			expect(result.data.ops).toStrictEqual([]);
		},
	);

	it("should use the process credential when preview constructs its gist backend", async ({
		expect,
		onTestFinished,
	}) => {
		expect.assertions(2);

		vi.stubEnv("BEDROCK_GITHUB_TOKEN", "fake-preview-token");
		onTestFinished(() => {
			vi.unstubAllEnvs();
		});
		const headers: Array<null | string> = [];
		const result = await previewDiff({
			config: {
				environments: { production: {} },
				state: { backend: "gist", gistId: "example" },
			},
			environment: "production",
			fetch: async (_url, init) => {
				const requestHeaders = new Headers(init!.headers);
				headers.push(requestHeaders.get("Authorization"));
				return new Response(JSON.stringify({ files: {} }), { status: 200 });
			},
		});
		assert(result.success);

		expect(result.data.ops).toStrictEqual([]);
		expect(headers).toStrictEqual(["Bearer fake-preview-token"]);
	});

	it("should persist no real-display values for a product authored entirely as its redaction placeholders", async ({
		expect,
	}) => {
		expect.assertions(2);

		const writes: Array<unknown> = [];
		const result = await deploy({
			config: {
				environments: { production: {} },
				products: {
					"bp-1": { name: "Hidden Product f5df4b", description: "", redacted: true },
				},
			},
			environment: "production",
			registry: {
				badge: BADGE_TRAP,
				developerProduct: {
					async create(desired) {
						return {
							data: {
								...desired,
								outputs: {
									iconImageAssetId: undefined,
									productId: asRobloxAssetId("100"),
								},
							},
							success: true,
						};
					},
					async retire() {
						throw new Error("unexpected retirement");
					},
				},
				gamePass: trapDriver,
				place: trapDriver,
				universe: trapDriver,
			},
			statePort: {
				...emptyState,
				async write(state) {
					writes.push(state);
					return { data: undefined, success: true };
				},
			},
		});
		assert(result.success);

		expect(writes).toHaveLength(1);
		expect(writes[0]).not.toHaveProperty("realDisplay");
	});

	it("should return a discovered config failure and print it in CLI mode before any state write", async ({
		expect,
		onTestFinished,
	}) => {
		expect.assertions(2);

		const cwd = mkdtempSync(join(tmpdir(), "bedrock-deploy-project-"));
		onTestFinished(() => {
			rmSync(cwd, { force: true, recursive: true });
		});
		writeFileSync(join(cwd, "bedrock.config.json"), "{ malformed");
		vi.spyOn(process, "cwd").mockReturnValue(cwd);
		onTestFinished(() => {
			vi.restoreAllMocks();
		});
		const streams = captureStreams();
		const result = await deploy({
			environment: "production",
			getEnv: environmentFrom({ BEDROCK_CLI: "1" }),
			statePort: emptyState,
		});
		assert(!result.success);

		expect(result.err).toMatchObject({
			cause: { kind: "parseFailed", sourceFile: join(cwd, "bedrock.config.json") },
			kind: "configLoadFailed",
		});
		expect([...streams.stderr, ...streams.stdout].join("")).toContain(
			`config load failed: ${join(cwd, "bedrock.config.json")}`,
		);
	});

	it.for([
		{ label: "loaded", options: {} },
		{ label: "explicit", options: { plugins: EMPTY_PLUGIN_REGISTRY } },
	] as const)(
		"should discover config before reporting an absent backend with $label plugins",
		async ({ options }, { expect, onTestFinished }) => {
			expect.assertions(1);

			const cwd = mkdtempSync(join(tmpdir(), "bedrock-deploy-no-backend-"));
			onTestFinished(() => {
				rmSync(cwd, { force: true, recursive: true });
			});
			writeFileSync(
				join(cwd, "bedrock.config.json"),
				JSON.stringify({ environments: { production: {} } }),
			);
			vi.spyOn(process, "cwd").mockReturnValue(cwd);
			onTestFinished(() => {
				vi.restoreAllMocks();
			});
			const result = await deploy({
				environment: "production",
				getEnv: () => {},
				...options,
			});
			assert(!result.success);

			expect(result.err.kind).toBe("stateNotConfigured");
		},
	);
});
