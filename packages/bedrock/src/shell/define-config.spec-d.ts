import { type } from "arktype";
import { describe, expectTypeOf, it } from "vitest";

import type { BedrockPlugin, StateBackendDeclaration } from "../core/plugin.ts";
import type { GistStateConfig, PluginStateConfig } from "../core/schema.ts";
import { defineConfig } from "./define-config.ts";

interface S3StateConfig {
	bucket: string;
	prefix?: string;
	region: string;
}

type S3Declaration = StateBackendDeclaration<S3StateConfig, "s3">;

/** The `state` block a config listing the s3 plugin may write for it. */
type S3StateBlock = S3StateConfig & { readonly backend: "s3"; readonly locking?: boolean };

const s3StateBackend: S3Declaration = {
	name: "s3",
	createPort: () => ({ err: { reason: "unused in type tests" }, success: false }),
	schema: type({ "bucket": "string", "prefix?": "string", "region": "string" }),
};

const s3Plugin: BedrockPlugin<readonly [S3Declaration]> = {
	name: "@example/state-s3",
	stateBackends: [s3StateBackend],
};

/** The set the union below is checked against, written out independently. */
type ExpectedS3State = GistStateConfig | S3StateBlock | undefined;

const ENVIRONMENTS = { production: {} };

// What `defineConfig` itself resolves `state` to for a config listing the
// s3 plugin, which is what the rejections below are stated against.
const s3Config = defineConfig({
	environments: ENVIRONMENTS,
	plugins: [s3Plugin],
	state: { backend: "s3", bucket: "my-bucket", prefix: "bedrock/", region: "eu-west-2" },
});

type S3State = NonNullable<typeof s3Config.state>;

describe(defineConfig, () => {
	it("should type the state block from what the listed plugins declare", () => {
		expectTypeOf(s3Config.state).toEqualTypeOf<ExpectedS3State>();
	});

	it("should reject a state key no listed plugin declared", () => {
		const state: S3State = {
			backend: "s3",
			bucket: "my-bucket",
			// @ts-expect-error -- bucketName is not a key the s3 backend declared
			bucketName: "my-bucket",
			region: "eu-west-2",
		};

		expectTypeOf(state).toExtend<S3State>();
	});

	it("should reject a state block missing a key the backend requires", () => {
		expectTypeOf<{ backend: "s3"; bucket: string }>().not.toExtend<S3State>();
	});

	it("should reject a backend name no listed plugin claims", () => {
		expectTypeOf<{ backend: "gcs"; bucket: string }>().not.toExtend<S3State>();
	});

	it("should type a per-environment state override the same way", () => {
		const config = defineConfig({
			environments: {
				production: {
					state: { backend: "s3", bucket: "my-bucket", region: "eu-west-2" },
				},
			},
			plugins: [s3Plugin],
		});

		expectTypeOf(config.environments["production"]!.state).toEqualTypeOf<
			GistStateConfig | S3StateBlock | undefined
		>();
	});

	it("should keep the builtin backend available alongside a listed plugin", () => {
		const config = defineConfig({
			environments: ENVIRONMENTS,
			plugins: [s3Plugin],
			state: { backend: "gist", gistId: "abc123def456" },
		});

		expectTypeOf(config.state).toEqualTypeOf<ExpectedS3State>();
	});

	it("should leave the state block open when a plugin is listed by specifier", () => {
		const config = defineConfig({
			environments: ENVIRONMENTS,
			plugins: ["@example/state-s3"],
			state: { anything: "goes", backend: "s3", bucket: "my-bucket" },
		});

		expectTypeOf(config.state).toEqualTypeOf<GistStateConfig | PluginStateConfig | undefined>();
	});

	it("should allow only the builtin backend when the config lists no plugins", () => {
		const config = defineConfig({
			environments: ENVIRONMENTS,
			state: { backend: "gist", gistId: "abc123def456" },
		});

		expectTypeOf(config.state).toEqualTypeOf<GistStateConfig | undefined>();
	});

	it("should carry the plugin-aware state type through the function form", () => {
		const build = defineConfig(() => {
			return {
				environments: ENVIRONMENTS,
				plugins: [s3Plugin],
				state: { backend: "s3" as const, bucket: "my-bucket", region: "eu-west-2" },
			};
		});

		expectTypeOf(build).returns.toExtend<{ state?: S3State }>();
	});
});
