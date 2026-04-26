import type { OpenCloudClientOptions, RequestOptions } from "../../client/types.ts";
import type { OpenCloudError } from "../../errors/base.ts";
import { CREATE_METHOD_DEFAULTS, IDEMPOTENT_METHOD_DEFAULTS } from "../../internal/http/retry.ts";
import type { HttpRequest } from "../../internal/http/types.ts";
import {
	okRequest,
	ResourceClient,
	type ResourceMethodSpec,
} from "../../internal/resource-client.ts";
import type { Result } from "../../types.ts";
import {
	buildDeleteIconRequest,
	buildListIconsRequest,
	buildUploadIconRequest,
} from "./builders.ts";
import {
	DELETE_ICON_OPERATION_LIMIT,
	LIST_ICONS_OPERATION_LIMIT,
	UPLOAD_ICON_OPERATION_LIMIT,
} from "./operations.ts";
import {
	parseIconDeleteResponse,
	parseIconListResponse,
	parseIconUploadResponse,
} from "./parsers.ts";
import type {
	DeleteExperienceIconParameters,
	ExperienceIcon,
	ListExperienceIconsParameters,
	UploadedExperienceIcon,
	UploadExperienceIconParameters,
} from "./types.ts";

function buildUploadSpec(
	parameters: UploadExperienceIconParameters,
): Result<HttpRequest, OpenCloudError> {
	return okRequest(buildUploadIconRequest(parameters));
}

function buildDeleteSpec(
	parameters: DeleteExperienceIconParameters,
): Result<HttpRequest, OpenCloudError> {
	return okRequest(buildDeleteIconRequest(parameters));
}

function buildListSpec(
	parameters: ListExperienceIconsParameters,
): Result<HttpRequest, OpenCloudError> {
	return okRequest(buildListIconsRequest(parameters));
}

const UPLOAD_SPEC: ResourceMethodSpec<UploadExperienceIconParameters, UploadedExperienceIcon> =
	Object.freeze({
		buildRequest: buildUploadSpec,
		methodDefaults: CREATE_METHOD_DEFAULTS,
		methodKind: "create",
		operationLimit: UPLOAD_ICON_OPERATION_LIMIT,
		parse: parseIconUploadResponse,
	});

const DELETE_SPEC: ResourceMethodSpec<DeleteExperienceIconParameters, undefined> = Object.freeze({
	buildRequest: buildDeleteSpec,
	methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
	methodKind: "idempotent",
	operationLimit: DELETE_ICON_OPERATION_LIMIT,
	parse: parseIconDeleteResponse,
});

const LIST_SPEC: ResourceMethodSpec<
	ListExperienceIconsParameters,
	ReadonlyArray<ExperienceIcon>
> = Object.freeze({
	buildRequest: buildListSpec,
	methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
	methodKind: "idempotent",
	operationLimit: LIST_ICONS_OPERATION_LIMIT,
	parse: parseIconListResponse,
});

/**
 * Public client for managing the localized icon registered against a Roblox
 * experience. Wires the request builders, the injected
 * {@link OpenCloudClientOptions.httpClient}, and the response parsers into a
 * single ergonomic surface. Every method returns a {@link Result} so callers
 * handle failure explicitly; no thrown {@link OpenCloudError} ever escapes
 * the client.
 *
 * Targets the legacy `gameinternationalization` service proxied through Open
 * Cloud at `apis.roblox.com/legacy-game-internationalization/v1/...`. Auth
 * uses the standard Open Cloud `x-api-key` header; no cookie auth is
 * involved.
 *
 * Uploading a 5xx-failed icon is not retried automatically: the upload is a
 * create operation and Roblox does not support idempotency keys, so a retry
 * could double-write asset moderation work. Callers that *can* detect
 * duplicates externally may opt back into 5xx retry per-call by passing
 * `retryableStatuses` on the second argument. The `delete` and `list`
 * methods retry both 429 and 5xx automatically.
 *
 * @example
 *
 * ```ts
 * import { ExperienceIconClient } from "@bedrock/ocale/experience-icon";
 *
 * const client = new ExperienceIconClient({ apiKey: "your-key" });
 * expect(client).toBeInstanceOf(ExperienceIconClient);
 * ```
 */
export class ExperienceIconClient {
	readonly #inner: ResourceClient;

	/**
	 * Creates a new {@link ExperienceIconClient}. Configuration is frozen on
	 * construction; per-request overrides are accepted on each method.
	 *
	 * @param options - Client-level configuration including the API key.
	 */
	constructor(options: OpenCloudClientOptions) {
		this.#inner = new ResourceClient(options);
	}

	/**
	 * Deletes the localized icon registered against a universe for a given
	 * language. Removing the source-language icon is rejected server-side;
	 * consumers must replace it via {@link upload} instead.
	 *
	 * @param parameters - Universe and language identifiers of the icon to
	 *   delete.
	 * @param options - Optional per-request overrides.
	 * @returns A success {@link Result} with no payload, or the
	 *   {@link OpenCloudError} that caused the request to fail.
	 */
	public async delete(
		parameters: DeleteExperienceIconParameters,
		options?: RequestOptions,
	): Promise<Result<undefined, OpenCloudError>> {
		return this.#inner.execute({ options, parameters, spec: DELETE_SPEC });
	}

	/**
	 * Lists every localized icon registered against an experience. The
	 * server returns one entry per locale that has an icon registered.
	 *
	 * @param parameters - Universe identifier whose icons to list.
	 * @param options - Optional per-request overrides.
	 * @returns A {@link Result} wrapping the parsed array of
	 *   {@link ExperienceIcon} entries or the {@link OpenCloudError} that
	 *   caused the request to fail.
	 */
	public async list(
		parameters: ListExperienceIconsParameters,
		options?: RequestOptions,
	): Promise<Result<ReadonlyArray<ExperienceIcon>, OpenCloudError>> {
		return this.#inner.execute({ options, parameters, spec: LIST_SPEC });
	}

	/**
	 * Uploads or replaces the localized icon for an experience. A subsequent
	 * upload for the same `(universeId, languageCode)` pair replaces the
	 * existing icon for that locale.
	 *
	 * @param parameters - Universe and language identifiers plus the image
	 *   bytes to upload.
	 * @param options - Optional per-request overrides (e.g. A different
	 *   {@link OpenCloudClientOptions.apiKey} for this call only).
	 * @returns A {@link Result} wrapping the parsed
	 *   {@link UploadedExperienceIcon} or the {@link OpenCloudError} that
	 *   caused the request to fail.
	 */
	public async upload(
		parameters: UploadExperienceIconParameters,
		options?: RequestOptions,
	): Promise<Result<UploadedExperienceIcon, OpenCloudError>> {
		return this.#inner.execute({ options, parameters, spec: UPLOAD_SPEC });
	}
}
