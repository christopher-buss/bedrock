import type { Credential } from "../client/types.ts";

/**
 * Copies a caller's credential, so a later change to the caller's object
 * cannot change the key or the OAuth identity a client or a queued request
 * uses. An OAuth provider stays a call on the caller's object, so a class
 * method keeps its `this`.
 *
 * @param credential - The caller's credential.
 * @returns A copy the caller does not hold.
 */
export function snapshotCredential(credential: Credential): Credential {
	if (credential.kind !== "oauth") {
		return { ...credential };
	}

	return {
		getAccessToken: async (context) => credential.getAccessToken(context),
		identity: credential.identity,
		kind: "oauth",
	};
}

/**
 * Copies the credential of a per-request override, if it has one.
 *
 * @template T - The override shape.
 * @param options - The caller's per-request overrides.
 * @returns The overrides, with a credential the caller does not hold.
 */
export function withCredentialSnapshot<T extends { readonly credential?: Credential }>(
	options: T,
): T {
	return options.credential === undefined
		? options
		: { ...options, credential: snapshotCredential(options.credential) };
}
