import type { Credential, ResolvedCredential } from "../../client/types.ts";

/**
 * The two ways a caller can name a credential: a {@link Credential} or a bare
 * API key. Either may be absent.
 */
export interface CredentialInputs {
	/** The bare API key, if any. */
	readonly apiKey?: string | undefined;
	/** The credential, if any. Wins over `apiKey`. */
	readonly credential?: Credential | undefined;
}

/**
 * The resolved credential plus the API key it carries, in the shape the
 * internal config spreads in.
 */
export interface ResolvedCredentialFields {
	/** The API key the resolved credential carries. */
	readonly apiKey: string;
	/** The resolved credential. */
	readonly credential: ResolvedCredential;
}

/**
 * Resolves the effective credential. The credential wins; the bare key fills
 * in when no credential is given, and an empty key when neither is.
 *
 * @param inputs - The caller's credential and bare API key.
 * @returns The resolved credential and the API key it carries.
 */
export function resolveCredential({
	apiKey,
	credential,
}: CredentialInputs): ResolvedCredentialFields {
	const key = credential?.apiKey ?? apiKey ?? "";
	return { apiKey: key, credential: { apiKey: key, kind: "apiKey" } };
}

/**
 * Resolves a per-request credential override. Returns no fields when the
 * request names no credential, so the client's credential stays in effect.
 *
 * @param inputs - The request's credential and bare API key.
 * @returns The resolved fields, or an empty object when there is no override.
 */
export function resolveCredentialOverride(
	inputs: CredentialInputs,
): Partial<ResolvedCredentialFields> {
	return inputs.apiKey === undefined && inputs.credential === undefined
		? {}
		: resolveCredential(inputs);
}
