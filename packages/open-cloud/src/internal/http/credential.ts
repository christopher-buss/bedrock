import type { Credential, ResolvedCredential } from "../../client/types.ts";
import type { OpenCloudError } from "../../errors/base.ts";
import { CredentialError } from "../../errors/credential-error.ts";
import type { Result } from "../../types.ts";

/**
 * Turns the effective credential into the header-ready form for one transport
 * attempt. Calls an OAuth provider once; a throw or a rejection becomes a
 * {@link CredentialError} whose `cause` is the provider's error.
 *
 * @param credential - The effective credential.
 * @param signal - The request's signal, handed to an OAuth provider. A
 *   request with no signal hands the provider one that never aborts.
 * @returns The resolved credential, or the provider failure.
 */
export async function resolveAttemptCredentialAsync(
	credential: Credential,
	signal: AbortSignal | undefined,
): Promise<Result<ResolvedCredential, OpenCloudError>> {
	if (credential.kind === "apiKey") {
		return { data: { apiKey: credential.apiKey, kind: "apiKey" }, success: true };
	}

	try {
		const accessToken = await credential.getAccessToken({
			signal: signal ?? neverAbortingSignal(),
		});
		return { data: { accessToken, kind: "oauth" }, success: true };
	} catch (err) {
		return {
			err: new CredentialError("OAuth credential provider failed", { cause: err }),
			success: false,
		};
	}
}

function neverAbortingSignal(): AbortSignal {
	const controller = new AbortController();
	return controller.signal;
}
