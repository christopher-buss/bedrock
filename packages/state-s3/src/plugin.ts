import type {
	BedrockPlugin,
	StateBackendContext,
	StateBackendDeclaration,
} from "@bedrock-rbx/core";

import { credentialsFrom } from "./credentials.ts";
import { lockOwnerFrom } from "./lock-owner.ts";
import { s3MigratePrompts, s3MigrateSource } from "./migrate.ts";
import type { S3StoreDeps } from "./s3-client.ts";
import { createS3StateAdapter } from "./s3-state-adapter.ts";
import { createS3StateLockPort } from "./s3-state-lock-adapter.ts";
import { type S3StateConfig, s3StateSchema } from "./state-schema.ts";

/**
 * The `state` **Backend** this plugin claims, which a user selects by
 * writing `state.backend: "s3"` alongside the keys
 * {@link s3StateSchema} declares.
 *
 * @since 0.2.0
 *
 * @example
 *
 * ```ts
 * import { s3StateBackend } from "@bedrock-rbx/state-s3";
 *
 * const built = s3StateBackend.createPort({
 *     fetch: async () => new Response("", { status: 200 }),
 *     getEnv: () => undefined,
 *     stateConfig: { bucket: "my-bucket", region: "eu-west-2" },
 * });
 *
 * expect(s3StateBackend.name).toBe("s3");
 * expect(built.success).toBeTrue();
 * ```
 */
export const s3StateBackend: StateBackendDeclaration<S3StateConfig, "s3"> = {
	name: "s3",
	createLockPort(context) {
		return {
			data: createS3StateLockPort({
				...bucketAccessFrom(context),
				lockLeaseMs: context.stateConfig.lockLeaseMs,
				lockTimeoutMs: context.stateConfig.lockTimeoutMs,
				owner: lockOwnerFrom(context.getEnv),
			}),
			success: true,
		};
	},
	createPort(context) {
		return { data: createS3StateAdapter(bucketAccessFrom(context)), success: true };
	},
	migratePrompts: s3MigratePrompts,
	migrateSource: s3MigrateSource,
	schema: s3StateSchema,
};

/**
 * This plugin, which is how a user gets the **Backend** into a **Deploy**.
 *
 * A config authored in TypeScript lists it directly, which types its
 * `state` block from what {@link s3StateSchema} declares. Every other
 * config format lists the module specifier instead, which reaches the same
 * plugin through the package's default export.
 *
 * @since unreleased
 *
 * @example
 *
 * ```ts
 * import { defineConfig } from "@bedrock-rbx/core/config";
 * import { bedrockS3Plugin } from "@bedrock-rbx/state-s3";
 *
 * const config = defineConfig({
 *     environments: { production: {} },
 *     plugins: [bedrockS3Plugin],
 *     state: { backend: "s3", bucket: "my-bucket", region: "eu-west-2" },
 * });
 *
 * expect(config.state?.backend).toBe("s3");
 * ```
 */
export const bedrockS3Plugin: BedrockPlugin<
	readonly [StateBackendDeclaration<S3StateConfig, "s3">]
> = {
	name: "@bedrock-rbx/state-s3",
	stateBackends: [s3StateBackend],
};

/**
 * Read the bucket both of this **Backend**'s ports reach out of what core
 * validated, so the **State** objects and the locks beside them are
 * addressed on identical terms.
 *
 * @param context - The validated `state` block plus the credential and
 * transport seams core injects.
 * @returns The bucket coordinates and the seams to build a port over.
 */
function bucketAccessFrom({
	fetch: fetchFunc,
	getEnv: getEnvironment,
	stateConfig,
}: StateBackendContext<S3StateConfig>): S3StoreDeps {
	return {
		bucket: stateConfig.bucket,
		checksumCalculation: stateConfig.checksumCalculation,
		credentials: credentialsFrom(getEnvironment),
		endpoint: stateConfig.endpoint,
		fetch: fetchFunc,
		forcePathStyle: stateConfig.forcePathStyle,
		prefix: stateConfig.prefix,
		region: stateConfig.region,
	};
}
