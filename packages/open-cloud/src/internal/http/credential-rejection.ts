import type { Credential } from "../../client/types.ts";
import { ApiError, requestContextOf } from "../../errors/api-error.ts";
import type { OpenCloudError } from "../../errors/base.ts";
import { CredentialRejectedError } from "../../errors/credential-rejected.ts";
import { PermissionError } from "../../errors/permission-error.ts";
import { extractErrorMessage } from "./error-body.ts";

/** The v1 body message Roblox sends on a 502 after an app removal. */
const SCOPE_AUTHORIZATION_FAILED = "Scope authorization failed.";

const OAUTH_PERMISSION_HINT =
	"The OAuth grant may not include the required scope or this universe.";

/** What the permission upgrade needs to know about the call. */
export interface PermissionContext {
	/** The effective credential of the call. */
	readonly credential: Credential;
	/** The operation key named on the upgraded error. */
	readonly operationKey: string;
	/**
	 * The scopes the method declares, if any. Without them there is no
	 * upgrade.
	 */
	readonly requiredScopes: ReadonlyArray<string> | undefined;
}

/**
 * Turns Roblox's refusal of an OAuth token into a
 * {@link CredentialRejectedError}: a non-gateway 401, or a non-gateway 502
 * whose body message is "Scope authorization failed.". The result is not an
 * `ApiError`, so the retry loop never retries it. Every other error, and
 * every error on an API-key credential, passes through unchanged.
 *
 * @param err - The transport error for one attempt.
 * @param credential - The effective credential of the call.
 * @returns The classified error.
 */
export function classifyCredentialRejection(
	err: OpenCloudError,
	credential: Credential,
): OpenCloudError {
	if (credential.kind !== "oauth" || !isTokenRefusal(err)) {
		return err;
	}

	return new CredentialRejectedError(err.message, {
		cause: err,
		code: err.code,
		identity: credential.identity,
		statusCode: err.statusCode,
	});
}

/**
 * Upgrades a non-gateway 401 or 403 `ApiError` to a {@link PermissionError}
 * when the method declares its scopes. On an OAuth credential the message
 * adds a hint that the grant may not include the scope or this universe.
 *
 * @param err - The final error of the call.
 * @param context - The credential, operation key and declared scopes.
 * @returns The upgraded error, or `err` unchanged.
 */
export function enrichPermissionError(
	err: OpenCloudError,
	{ credential, operationKey, requiredScopes }: PermissionContext,
): OpenCloudError {
	if (requiredScopes === undefined) {
		return err;
	}

	if (err instanceof PermissionError) {
		return err;
	}

	if (!(err instanceof ApiError)) {
		return err;
	}

	if (err.statusCode !== 401 && err.statusCode !== 403) {
		return err;
	}

	// An edge gateway answers 401 and 403 for its own reasons, and the request
	// never reached the operation whose scopes these are.
	if (err.gatewaySummary !== undefined) {
		return err;
	}

	return new PermissionError(permissionMessage(err.message, credential), {
		...requestContextOf(err),
		cause: err.cause,
		code: err.code,
		details: err.details,
		operationKey,
		requiredScopes,
		statusCode: err.statusCode,
	});
}

function isTokenRefusal(err: OpenCloudError): err is ApiError {
	if (!(err instanceof ApiError) || err.gatewaySummary !== undefined) {
		return false;
	}

	return (
		err.statusCode === 401 ||
		(err.statusCode === 502 && extractErrorMessage(err.details) === SCOPE_AUTHORIZATION_FAILED)
	);
}

function permissionMessage(message: string, credential: Credential): string {
	if (credential.kind !== "oauth") {
		return message;
	}

	const separator = message.endsWith(".") ? " " : ". ";
	return `${message}${separator}${OAUTH_PERMISSION_HINT}`;
}
