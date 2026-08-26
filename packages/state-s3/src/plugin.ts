import type {
	BedrockPlugin,
	StateBackendContext,
	StateBackendDeclaration,
} from "@bedrock-rbx/core";
import type { AwsCredentialIdentity } from "@smithy/types";

import { createS3StateAdapter } from "./s3-state-adapter.ts";
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
	createPort({ fetch: fetchFunc, getEnv: getEnvironment, stateConfig }) {
		return {
			data: createS3StateAdapter({
				bucket: stateConfig.bucket,
				checksumCalculation: stateConfig.checksumCalculation,
				credentials: credentialsFrom(getEnvironment),
				endpoint: stateConfig.endpoint,
				fetch: fetchFunc,
				forcePathStyle: stateConfig.forcePathStyle,
				prefix: stateConfig.prefix,
				region: stateConfig.region,
			}),
			success: true,
		};
	},
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
export const s3StatePlugin: BedrockPlugin = { stateBackends: [s3StateBackend] };

export default s3StatePlugin;

/**
 * Read static credentials out of the environment core injected, so a
 * **Deploy** signs with what the caller handed it rather than with
 * whatever the process happens to hold.
 *
 * Only the environment-variable step of the standard AWS chain is read
 * here, and only when it has both halves of a credential. Anything else -
 * a shared profile, an SSO session, CI role credentials - is left to the
 * chain itself, which the adapter falls back to.
 *
 * @param getEnvironment - Reads an environment variable.
 * @returns The credential the environment names, or `undefined` to leave
 * resolution to the standard chain.
 */
function credentialsFrom(
	getEnvironment: StateBackendContext["getEnv"],
): AwsCredentialIdentity | undefined {
	const accessKeyId = getEnvironment("AWS_ACCESS_KEY_ID");
	const secretAccessKey = getEnvironment("AWS_SECRET_ACCESS_KEY");
	if (accessKeyId === undefined || secretAccessKey === undefined) {
		return undefined;
	}

	const sessionToken = getEnvironment("AWS_SESSION_TOKEN");
	return sessionToken === undefined
		? { accessKeyId, secretAccessKey }
		: { accessKeyId, secretAccessKey, sessionToken };
}
