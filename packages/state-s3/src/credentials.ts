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
 * chain itself, which the adapter falls back to. A variable set to nothing
 * is read as one the environment does not hold, which is what a CI job
 * whose secret went unset leaves behind: signing with it would refuse
 * every request rather than letting the chain resolve.
 *
 * @param getEnvironment - Reads an environment variable.
 * @returns The credential the environment names, or `undefined` to leave
 * resolution to the standard chain.
 */
export function credentialsFrom(
	getEnvironment: StateBackendContext["getEnv"],
): AwsCredentialIdentity | undefined {
	const accessKeyId = heldBy(getEnvironment, "AWS_ACCESS_KEY_ID");
	const secretAccessKey = heldBy(getEnvironment, "AWS_SECRET_ACCESS_KEY");
	if (accessKeyId === undefined || secretAccessKey === undefined) {
		return undefined;
	}

	const sessionToken = heldBy(getEnvironment, "AWS_SESSION_TOKEN");
	return sessionToken === undefined
		? { accessKeyId, secretAccessKey }
		: { accessKeyId, secretAccessKey, sessionToken };
}

/**
 * Read one variable the environment holds something in.
 *
 * @param getEnvironment - Reads an environment variable.
 * @param name - Variable to read.
 * @returns What it holds, or `undefined` when it holds nothing.
 */
function heldBy(getEnvironment: StateBackendContext["getEnv"], name: string): string | undefined {
	const value = getEnvironment(name);
	return value === undefined || value.trim() === "" ? undefined : value;
}
