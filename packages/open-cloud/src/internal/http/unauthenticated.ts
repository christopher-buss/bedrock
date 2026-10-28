import type { ResolvedCredential } from "../../client/types.ts";
import type { OpenCloudError } from "../../errors/base.ts";
import type { Result } from "../../types.ts";
import { classifyCredentialRejection } from "./credential-rejection.ts";
import {
	credentialQueueKey,
	resolveAttemptCredentialAsync,
	type SendingCredential,
} from "./credential.ts";
import type { RetryResolvable } from "./retry.ts";

/** What a method declares about its authentication. */
interface AuthenticationSpec {
	readonly unauthenticatedBaseUrl?: string;
}

/** The call's config and credential once its authentication is applied. */
interface CallAuthentication {
	/** The credential to send, or `undefined` for an unauthenticated call. */
	readonly credential: SendingCredential | undefined;
	/**
	 * The merged config, pointed at the method's own origin when it has one.
	 */
	readonly merged: RetryResolvable;
}

const UNAUTHENTICATED_QUEUE_KEY = "none";

const UNAUTHENTICATED = Object.freeze({
	data: Object.freeze({ kind: "none" }),
	success: true,
} satisfies Result<ResolvedCredential, OpenCloudError>);

/**
 * Applies a method's authentication to the merged config. An unauthenticated
 * method is served from its own origin and carries no credential. A
 * `{ kind: "none" }` credential carries none either.
 *
 * @param merged - The merged config of the call.
 * @param spec - The method's authentication declaration.
 * @returns The config to send with and the credential, if any.
 */
export function authenticateCall(
	merged: RetryResolvable,
	{ unauthenticatedBaseUrl }: AuthenticationSpec,
): CallAuthentication {
	if (unauthenticatedBaseUrl !== undefined) {
		return { credential: undefined, merged: { ...merged, baseUrl: unauthenticatedBaseUrl } };
	}

	return {
		credential: merged.credential.kind === "none" ? undefined : merged.credential,
		merged,
	};
}

/**
 * Keys the rate-limit queue of a call. Every unauthenticated call shares one
 * key, since Roblox counts those per caller.
 *
 * @param credential - The call's credential, or `undefined` when it sends
 *   none.
 * @returns The credential's queue key, or the shared unauthenticated key.
 */
export function callQueueKey(credential: SendingCredential | undefined): string {
	return credential === undefined ? UNAUTHENTICATED_QUEUE_KEY : credentialQueueKey(credential);
}

/**
 * Resolves the credential one attempt sends. An unauthenticated call sends
 * none and runs no OAuth provider.
 *
 * @param credential - The call's credential, if any.
 * @param signal - The caller's cancellation signal.
 * @returns The resolved credential, or the provider failure.
 */
export async function resolveCallCredentialAsync(
	credential: SendingCredential | undefined,
	signal: AbortSignal | undefined,
): Promise<Result<ResolvedCredential, OpenCloudError>> {
	return credential === undefined
		? UNAUTHENTICATED
		: resolveAttemptCredentialAsync(credential, signal);
}

/**
 * Refines one attempt's transport error, then classifies a refused OAuth
 * token. An unauthenticated call sent no token, so none was refused.
 *
 * @param err - The transport error of the attempt.
 * @param context - The call's credential and optional refinement.
 * @returns The classified error.
 */
export function classifySendError(
	err: OpenCloudError,
	{
		credential,
		refineError,
	}: {
		readonly credential: SendingCredential | undefined;
		readonly refineError: ((error: OpenCloudError) => OpenCloudError) | undefined;
	},
): OpenCloudError {
	const refined = refineError === undefined ? err : refineError(err);
	return credential === undefined ? refined : classifyCredentialRejection(refined, credential);
}
