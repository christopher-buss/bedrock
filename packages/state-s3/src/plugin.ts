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
 * @since unreleased
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
export const s3StateBackend: StateBackendDeclaration<S3StateConfig> = {
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
 * What a module listed under the config's `plugins` field
 * default-exports, which is how a user gets this **Backend** into a
 * **Deploy**.
 *
 * @since unreleased
 *
 * @example
 *
 * ```ts
 * import s3Plugin from "@bedrock-rbx/state-s3";
 *
 * expect(s3Plugin.stateBackends).toHaveLength(1);
 * ```
 */
const s3StatePlugin: BedrockPlugin = { stateBackends: [s3StateBackend] };

export default s3StatePlugin;

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
