import type { OpenCloudClientOptions, RequestOptions } from "../../client/types.ts";
import type { OpenCloudError } from "../../errors/base.ts";
import { CREATE_METHOD_DEFAULTS, IDEMPOTENT_METHOD_DEFAULTS } from "../../internal/http/retry.ts";
import type { HttpRequest } from "../../internal/http/types.ts";
import {
	okRequest,
	parseEmptyResponse,
	ResourceClient,
	type ResourceMethodSpec,
} from "../../internal/resource-client.ts";
import type { Result } from "../../types.ts";
import {
	buildDeleteThumbnailRequest,
	buildReorderThumbnailsRequest,
	buildUploadThumbnailRequest,
} from "./builders.ts";
import {
	DELETE_OPERATION_LIMIT,
	REORDER_OPERATION_LIMIT,
	UPLOAD_OPERATION_LIMIT,
} from "./operations.ts";
import { parseThumbnailUploadResponse } from "./parsers.ts";
import type {
	DeleteExperienceThumbnailParameters,
	ReorderExperienceThumbnailsParameters,
	UploadedExperienceThumbnail,
	UploadExperienceThumbnailParameters,
} from "./types.ts";

function buildUploadSpec(
	parameters: UploadExperienceThumbnailParameters,
): Result<HttpRequest, OpenCloudError> {
	return okRequest(buildUploadThumbnailRequest(parameters));
}

function buildDeleteSpec(
	parameters: DeleteExperienceThumbnailParameters,
): Result<HttpRequest, OpenCloudError> {
	return okRequest(buildDeleteThumbnailRequest(parameters));
}

const UPLOAD_SPEC: ResourceMethodSpec<
	UploadExperienceThumbnailParameters,
	UploadedExperienceThumbnail
> = Object.freeze({
	buildRequest: buildUploadSpec,
	methodDefaults: CREATE_METHOD_DEFAULTS,
	methodKind: "create",
	operationLimit: UPLOAD_OPERATION_LIMIT,
	parse: parseThumbnailUploadResponse,
});

const DELETE_SPEC: ResourceMethodSpec<DeleteExperienceThumbnailParameters, undefined> =
	Object.freeze({
		buildRequest: buildDeleteSpec,
		methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
		methodKind: "idempotent",
		operationLimit: DELETE_OPERATION_LIMIT,
		parse: parseEmptyResponse,
	});

const REORDER_SPEC: ResourceMethodSpec<ReorderExperienceThumbnailsParameters, undefined> =
	Object.freeze({
		buildRequest: buildReorderThumbnailsRequest,
		methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
		methodKind: "idempotent",
		operationLimit: REORDER_OPERATION_LIMIT,
		parse: parseEmptyResponse,
	});

/**
 * Public client for managing the localized screenshot carousel registered
 * against a Roblox experience. Wires request builders, the injected
 * {@link OpenCloudClientOptions.httpClient}, and response parsers into a
 * single ergonomic surface. Every method returns a {@link Result} so callers
 * handle failure explicitly; no thrown {@link OpenCloudError} ever escapes
 * the client.
 *
 * Targets the legacy `gameinternationalization` service proxied through Open
 * Cloud; auth uses the standard `x-api-key` header. No list-thumbnails
 * endpoint is bridged; consumers must track uploaded `mediaAssetId`s in
 * their own state store to reconcile against the existing carousel.
 *
 * @example
 *
 * ```ts
 * import { ExperienceThumbnailsClient } from "@bedrock/ocale/experience-thumbnails";
 *
 * const client = new ExperienceThumbnailsClient({ apiKey: "your-key" });
 * expect(client).toBeInstanceOf(ExperienceThumbnailsClient);
 * ```
 */
export class ExperienceThumbnailsClient {
	readonly #inner: ResourceClient;

	/**
	 * Creates a new {@link ExperienceThumbnailsClient}. Configuration is
	 * frozen on construction; per-request overrides are accepted on each
	 * method.
	 *
	 * @param options - Client-level configuration including the API key.
	 */
	constructor(options: OpenCloudClientOptions) {
		this.#inner = new ResourceClient(options);
	}

	/**
	 * Deletes a single thumbnail by media asset ID. Idempotent: deleting an
	 * already-removed thumbnail surfaces the server's 404 unchanged.
	 *
	 * @param parameters - Universe, language, and image identifiers of the
	 *   thumbnail to delete.
	 * @param options - Optional per-request overrides.
	 * @returns A success {@link Result} with no payload, or the
	 *   {@link OpenCloudError} that caused the request to fail.
	 */
	public async delete(
		parameters: DeleteExperienceThumbnailParameters,
		options?: RequestOptions,
	): Promise<Result<undefined, OpenCloudError>> {
		return this.#inner.execute({ options, parameters, spec: DELETE_SPEC });
	}

	/**
	 * Reorders the localized thumbnail carousel. The supplied
	 * `orderedImageIds` describes the desired display order from first to
	 * last. Image IDs must be positive integers within the safe-integer
	 * range; invalid input is rejected with a {@link OpenCloudError} of
	 * kind `ValidationError` before any HTTP round-trip.
	 *
	 * @param parameters - Universe, language, and the desired display order.
	 * @param options - Optional per-request overrides.
	 * @returns A success {@link Result} with no payload, or the
	 *   {@link OpenCloudError} that caused the request to fail.
	 */
	public async reorder(
		parameters: ReorderExperienceThumbnailsParameters,
		options?: RequestOptions,
	): Promise<Result<undefined, OpenCloudError>> {
		return this.#inner.execute({ options, parameters, spec: REORDER_SPEC });
	}

	/**
	 * Uploads a new thumbnail and appends it to the localized carousel. Use
	 * {@link reorder} after multiple uploads to set the display order.
	 *
	 * @param parameters - Universe and language identifiers plus the image
	 *   bytes to upload.
	 * @param options - Optional per-request overrides (e.g. A different
	 *   {@link OpenCloudClientOptions.apiKey} for this call only).
	 * @returns A {@link Result} wrapping the parsed
	 *   {@link UploadedExperienceThumbnail} or the {@link OpenCloudError}
	 *   that caused the request to fail.
	 */
	public async upload(
		parameters: UploadExperienceThumbnailParameters,
		options?: RequestOptions,
	): Promise<Result<UploadedExperienceThumbnail, OpenCloudError>> {
		return this.#inner.execute({ options, parameters, spec: UPLOAD_SPEC });
	}
}
