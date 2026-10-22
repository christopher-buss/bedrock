import type { Credential } from "../client/types.ts";
import { CredentialNotSupportedError } from "../errors/credential-not-supported.ts";
import type { Result } from "../types.ts";
import type { OperationLimit } from "./http/rate-limit-queue.ts";

/** The parts of a method spec the API-key-only check reads. */
interface ApiKeyOnlySpec {
	readonly apiKeyOnly?: boolean;
	readonly operationLimit: OperationLimit;
}

/**
 * Fails an OAuth call to an Operation that Roblox accepts only with an API
 * key. Runs before the provider is asked for a token and before any request.
 *
 * @param spec - The method spec's flag and operation limit.
 * @param credential - The effective credential for the call.
 * @returns A {@link CredentialNotSupportedError} failure, or `undefined` when
 *   the call may proceed.
 */
export function credentialNotSupportedFailure(
	spec: ApiKeyOnlySpec,
	credential: Credential,
): Result<never, CredentialNotSupportedError> | undefined {
	if (spec.apiKeyOnly !== true || credential.kind !== "oauth") {
		return undefined;
	}

	const { operationKey } = spec.operationLimit;
	return {
		err: new CredentialNotSupportedError(
			`Operation ${operationKey} accepts only an API key credential`,
			{ operationKey },
		),
		success: false,
	};
}
