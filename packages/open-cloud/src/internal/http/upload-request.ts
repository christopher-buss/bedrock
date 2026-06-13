import type { HttpRequest } from "../../client/types.ts";

/**
 * Reports whether a request is an upload: its body is `FormData`
 * (multipart) or `Uint8Array` (raw binary). Upload latency is
 * bandwidth-bound rather than compute-bound, so the SDK applies no default
 * request timeout to these requests; a sensible wall-clock budget depends on
 * payload size and link quality the SDK cannot know.
 *
 * @param request - The built request to classify.
 * @returns `true` when the body is `FormData` or `Uint8Array`.
 */
export function isUploadRequest(request: HttpRequest): boolean {
	return request.body instanceof FormData || request.body instanceof Uint8Array;
}
