import type { Except } from "type-fest";

import type { HttpRequest, RequestConfig, RequestOptions } from "../../client/types.ts";
import type { RetryResolvable } from "./retry.ts";
import { isUploadRequest } from "./upload-request.ts";

/**
 * Inputs to {@link buildRequestConfig}, bundled to keep the signature narrow.
 */
export interface RequestConfigInputs {
	/** The resolved config for this call. */
	readonly merged: RetryResolvable;
	/** The caller's per-request overrides, if any. */
	readonly options: RequestOptions | undefined;
	/** The built request, inspected for an upload body. */
	readonly request: HttpRequest;
	/** Caller and deadline signal composed for the whole logical request. */
	readonly signal: AbortSignal | undefined;
}

/**
 * Resolves the per-request {@link RequestConfig}, less the credential, which
 * is resolved per transport attempt. Upload requests ({@link isUploadRequest})
 * carry no default timeout: a multi-megabyte place file over a slow link is
 * bandwidth-bound, so a transport-attempt timeout only fires spuriously. An
 * explicit `options.timeout` still applies to any request; every non-upload
 * request keeps the merged default.
 *
 * @param inputs - The merged config, the built request, and per-request
 *   overrides.
 * @returns The config to hand to the transport, with `timeout` omitted when
 *   no transport-attempt timeout should apply.
 */
export function buildRequestConfig({
	merged,
	options,
	request,
	signal,
}: RequestConfigInputs): Except<RequestConfig, "credential"> {
	const shouldOmitDefaultTimeout = options?.timeout === undefined && isUploadRequest(request);
	return {
		baseUrl: merged.baseUrl,
		...(signal === undefined ? {} : { signal }),
		...(shouldOmitDefaultTimeout ? {} : { timeout: merged.timeout }),
	};
}
