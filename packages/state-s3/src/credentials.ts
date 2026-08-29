import type { StateBackendContext } from "@bedrock-rbx/core";
import type { AwsCredentialIdentity } from "@smithy/types";

/** The variables one whole credential is named by. */
interface CredentialVariables {
	readonly accessKeyId: string;
	readonly secretAccessKey: string;
	readonly sessionToken: string;
}

// The bedrock-prefixed names, read before the standard ones.
const BEDROCK_VARIABLES = {
	accessKeyId: "BEDROCK_S3_ACCESS_KEY_ID",
	secretAccessKey: "BEDROCK_S3_SECRET_ACCESS_KEY",
	sessionToken: "BEDROCK_S3_SESSION_TOKEN",
} satisfies CredentialVariables;

const AWS_VARIABLES = {
	accessKeyId: "AWS_ACCESS_KEY_ID",
	secretAccessKey: "AWS_SECRET_ACCESS_KEY",
	sessionToken: "AWS_SESSION_TOKEN",
} satisfies CredentialVariables;

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
 * Each set of names is read as a whole credential. A half-written
 * bedrock-prefixed pair leaves the standard one to sign on its own terms,
 * and a bedrock-prefixed pair takes its session token from
 * `BEDROCK_S3_SESSION_TOKEN` alone, so nothing here signs with one
 * account's key and another's secret.
 *
 * @param getEnvironment - Reads an environment variable.
 * @returns The credential the environment names, or `undefined` to leave
 * resolution to the standard chain.
 */
export function credentialsFrom(
	getEnvironment: StateBackendContext["getEnv"],
): AwsCredentialIdentity | undefined {
	return (
		credentialNamedBy(getEnvironment, BEDROCK_VARIABLES) ??
		credentialNamedBy(getEnvironment, AWS_VARIABLES)
	);
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

/**
 * Read the credential one set of names holds, taking its session token
 * from the set the pair itself came out of.
 *
 * @param getEnvironment - Reads an environment variable.
 * @param names - The variables to read the credential out of.
 * @returns The credential, or `undefined` when the set is missing either
 * half of one.
 */
function credentialNamedBy(
	getEnvironment: StateBackendContext["getEnv"],
	names: CredentialVariables,
): AwsCredentialIdentity | undefined {
	const accessKeyId = heldBy(getEnvironment, names.accessKeyId);
	const secretAccessKey = heldBy(getEnvironment, names.secretAccessKey);
	if (accessKeyId === undefined || secretAccessKey === undefined) {
		return undefined;
	}

	const sessionToken = heldBy(getEnvironment, names.sessionToken);
	return sessionToken === undefined
		? { accessKeyId, secretAccessKey }
		: { accessKeyId, secretAccessKey, sessionToken };
}
