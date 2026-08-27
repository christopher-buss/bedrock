import type { StateBackendContext } from "@bedrock-rbx/core";
import type { AwsCredentialIdentity } from "@smithy/types";

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
export function credentialsFrom(
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
