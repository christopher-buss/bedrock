import type { OpenCloudClientOptions, RequestOptions } from "../../client/types.ts";
import {
	buildDeleteIconRequest,
	buildListIconsRequest,
	buildUploadIconRequest,
} from "../../domains/game-internationalization/game-icon/builders.ts";
import { ICON_OPERATION_LIMIT } from "../../domains/game-internationalization/game-icon/operations.ts";
import { parseIconListResponse } from "../../domains/game-internationalization/game-icon/parsers.ts";
import type {
	DeleteExperienceIconParameters,
	ExperienceIcon,
	ListExperienceIconsParameters,
	UploadExperienceIconParameters,
} from "../../domains/game-internationalization/game-icon/types.ts";
import {
	buildDeleteThumbnailRequest,
	buildReorderThumbnailsRequest,
	buildUploadThumbnailRequest,
} from "../../domains/game-internationalization/game-thumbnails/builders.ts";
import { THUMBNAILS_OPERATION_LIMIT } from "../../domains/game-internationalization/game-thumbnails/operations.ts";
import { parseThumbnailUploadResponse } from "../../domains/game-internationalization/game-thumbnails/parsers.ts";
import type {
	DeleteExperienceThumbnailParameters,
	ReorderExperienceThumbnailsParameters,
	UploadedExperienceThumbnail,
	UploadExperienceThumbnailParameters,
} from "../../domains/game-internationalization/game-thumbnails/types.ts";
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
import { buildGetRequest, buildUpdateRequest } from "./builders.ts";
import { GET_OPERATION_LIMIT, UPDATE_OPERATION_LIMIT } from "./operations.ts";
import { parseUniverseResponse } from "./parsers.ts";
import type { GetUniverseParameters, Universe, UpdateUniverseParameters } from "./types.ts";

const GET_SPEC: ResourceMethodSpec<GetUniverseParameters, Universe> = Object.freeze({
	buildRequest: buildGetRequest,
	methodDefaults: {},
	methodKind: "idempotent",
	operationLimit: GET_OPERATION_LIMIT,
	parse: parseUniverseResponse,
});

const UPDATE_SPEC: ResourceMethodSpec<UpdateUniverseParameters, Universe> = Object.freeze({
	buildRequest: buildUpdateRequest,
	methodDefaults: {},
	methodKind: "idempotent",
	operationLimit: UPDATE_OPERATION_LIMIT,
	parse: parseUniverseResponse,
});

function buildIconUploadOkRequest(
	parameters: UploadExperienceIconParameters,
): Result<HttpRequest, OpenCloudError> {
	return okRequest(buildUploadIconRequest(parameters));
}

function buildIconDeleteOkRequest(
	parameters: DeleteExperienceIconParameters,
): Result<HttpRequest, OpenCloudError> {
	return okRequest(buildDeleteIconRequest(parameters));
}

function buildIconListOkRequest(
	parameters: ListExperienceIconsParameters,
): Result<HttpRequest, OpenCloudError> {
	return okRequest(buildListIconsRequest(parameters));
}

const ICON_UPLOAD_SPEC: ResourceMethodSpec<UploadExperienceIconParameters, undefined> =
	Object.freeze({
		buildRequest: buildIconUploadOkRequest,
		methodDefaults: CREATE_METHOD_DEFAULTS,
		methodKind: "create",
		operationLimit: ICON_OPERATION_LIMIT,
		parse: parseEmptyResponse,
	});

const ICON_DELETE_SPEC: ResourceMethodSpec<DeleteExperienceIconParameters, undefined> =
	Object.freeze({
		buildRequest: buildIconDeleteOkRequest,
		methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
		methodKind: "idempotent",
		operationLimit: ICON_OPERATION_LIMIT,
		parse: parseEmptyResponse,
	});

const ICON_LIST_SPEC: ResourceMethodSpec<
	ListExperienceIconsParameters,
	ReadonlyArray<ExperienceIcon>
> = Object.freeze({
	buildRequest: buildIconListOkRequest,
	methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
	methodKind: "idempotent",
	operationLimit: ICON_OPERATION_LIMIT,
	parse: parseIconListResponse,
});

function buildThumbnailUploadOkRequest(
	parameters: UploadExperienceThumbnailParameters,
): Result<HttpRequest, OpenCloudError> {
	return okRequest(buildUploadThumbnailRequest(parameters));
}

function buildThumbnailDeleteOkRequest(
	parameters: DeleteExperienceThumbnailParameters,
): Result<HttpRequest, OpenCloudError> {
	return okRequest(buildDeleteThumbnailRequest(parameters));
}

const THUMBNAIL_UPLOAD_SPEC: ResourceMethodSpec<
	UploadExperienceThumbnailParameters,
	UploadedExperienceThumbnail
> = Object.freeze({
	buildRequest: buildThumbnailUploadOkRequest,
	methodDefaults: CREATE_METHOD_DEFAULTS,
	methodKind: "create",
	operationLimit: THUMBNAILS_OPERATION_LIMIT,
	parse: parseThumbnailUploadResponse,
});

const THUMBNAIL_DELETE_SPEC: ResourceMethodSpec<DeleteExperienceThumbnailParameters, undefined> =
	Object.freeze({
		buildRequest: buildThumbnailDeleteOkRequest,
		methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
		methodKind: "idempotent",
		operationLimit: THUMBNAILS_OPERATION_LIMIT,
		parse: parseEmptyResponse,
	});

const THUMBNAIL_REORDER_SPEC: ResourceMethodSpec<ReorderExperienceThumbnailsParameters, undefined> =
	Object.freeze({
		buildRequest: buildReorderThumbnailsRequest,
		methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
		methodKind: "idempotent",
		operationLimit: THUMBNAILS_OPERATION_LIMIT,
		parse: parseEmptyResponse,
	});

interface UniverseIconHandle {
	/**
	 * Deletes the localized icon registered against a universe for a given
	 * language. Removing the source-language icon is rejected server-side;
	 * consumers must replace it via {@link UniverseIconHandle.upload}
	 * instead.
	 *
	 * @param parameters - Universe and language identifiers of the icon to
	 *   delete.
	 * @param options - Optional per-request overrides.
	 * @returns A success {@link Result} with no payload, or the
	 *   {@link OpenCloudError} that caused the request to fail.
	 */
	delete: (
		parameters: DeleteExperienceIconParameters,
		options?: RequestOptions,
	) => Promise<Result<undefined, OpenCloudError>>;
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
	list: (
		parameters: ListExperienceIconsParameters,
		options?: RequestOptions,
	) => Promise<Result<ReadonlyArray<ExperienceIcon>, OpenCloudError>>;
	/**
	 * Uploads or replaces the localized icon for an experience. A
	 * subsequent upload for the same `(universeId, languageCode)` pair
	 * replaces the existing icon for that locale.
	 *
	 * @param parameters - Universe and language identifiers plus the image
	 *   bytes to upload.
	 * @param options - Optional per-request overrides (e.g. A different
	 *   {@link OpenCloudClientOptions.apiKey} for this call only).
	 * @returns A success {@link Result} with no payload, or the
	 *   {@link OpenCloudError} that caused the request to fail.
	 */
	upload: (
		parameters: UploadExperienceIconParameters,
		options?: RequestOptions,
	) => Promise<Result<undefined, OpenCloudError>>;
}

interface UniverseThumbnailsHandle {
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
	delete: (
		parameters: DeleteExperienceThumbnailParameters,
		options?: RequestOptions,
	) => Promise<Result<undefined, OpenCloudError>>;
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
	reorder: (
		parameters: ReorderExperienceThumbnailsParameters,
		options?: RequestOptions,
	) => Promise<Result<undefined, OpenCloudError>>;
	/**
	 * Uploads a new thumbnail and appends it to the localized carousel. Use
	 * {@link UniverseThumbnailsHandle.reorder} after multiple uploads to
	 * set the display order.
	 *
	 * @param parameters - Universe and language identifiers plus the image
	 *   bytes to upload.
	 * @param options - Optional per-request overrides (e.g. A different
	 *   {@link OpenCloudClientOptions.apiKey} for this call only).
	 * @returns A {@link Result} wrapping the parsed
	 *   {@link UploadedExperienceThumbnail} or the {@link OpenCloudError}
	 *   that caused the request to fail.
	 */
	upload: (
		parameters: UploadExperienceThumbnailParameters,
		options?: RequestOptions,
	) => Promise<Result<UploadedExperienceThumbnail, OpenCloudError>>;
}

/**
 * Public client for the Roblox Open Cloud `Universe` resource. Wires
 * the request builders, the injected
 * {@link OpenCloudClientOptions.httpClient}, and the response parser
 * into a single ergonomic surface. Every method returns a
 * {@link Result} so callers handle failure explicitly; no thrown
 * {@link OpenCloudError} ever escapes the client.
 *
 * Partial updates use a Google-style `updateMask` query string derived
 * from the keys present on the update parameters. Setting a clearable
 * field (`privateServerPriceRobux` or any social link) to `undefined`
 * sends JSON `null` for that field so the server clears the
 * corresponding value.
 *
 * Localized experience-icon and experience-thumbnail Operations are
 * bound on the {@link UniversesClient.icon} and
 * {@link UniversesClient.thumbnails} Operation Groups so callers reach
 * for one client per universe.
 *
 * @example
 *
 * ```ts
 * import { UniversesClient } from "@bedrock/ocale/universes";
 *
 * const client = new UniversesClient({ apiKey: "your-key" });
 * expect(client).toBeInstanceOf(UniversesClient);
 * ```
 */
export class UniversesClient {
	readonly #inner: ResourceClient;

	/**
	 * Operation Group exposing the localized experience-icon
	 * Operations (`upload`, `delete`, `list`) backed by the
	 * `legacy-game-internationalization` domain. Shares the parent
	 * client's HTTP, rate-limit, and retry plumbing.
	 */
	public readonly icon: UniverseIconHandle;
	/**
	 * Operation Group exposing the localized experience-thumbnail
	 * Operations (`upload`, `delete`, `reorder`) backed by the
	 * `legacy-game-internationalization` domain. No list-thumbnails
	 * endpoint is bridged; consumers must track uploaded
	 * `mediaAssetId`s in their own state store to reconcile against
	 * the existing carousel. Shares the parent client's HTTP,
	 * rate-limit, and retry plumbing.
	 */
	public readonly thumbnails: UniverseThumbnailsHandle;

	/**
	 * Creates a new {@link UniversesClient}. Configuration is frozen
	 * on construction; per-request overrides are accepted on each
	 * method.
	 *
	 * @param options - Client-level configuration including the API key.
	 */
	constructor(options: OpenCloudClientOptions) {
		this.#inner = new ResourceClient(options);
		this.icon = createIconHandle(this.#inner);
		this.thumbnails = createThumbnailsHandle(this.#inner);
	}

	/**
	 * Fetches the current configuration of a universe.
	 *
	 * @param parameters - The universe identifier.
	 * @param options - Optional per-request overrides (e.g. A different
	 *   {@link OpenCloudClientOptions.apiKey} for this call only).
	 * @returns A {@link Result} wrapping the parsed {@link Universe}
	 *   or the {@link OpenCloudError} that caused the request to fail.
	 */
	public async get(
		parameters: GetUniverseParameters,
		options?: RequestOptions,
	): Promise<Result<Universe, OpenCloudError>> {
		return this.#inner.execute({ options, parameters, spec: GET_SPEC });
	}

	/**
	 * Partially updates a universe's configuration. The fields
	 * supplied on `parameters` (excluding `universeId`) are forwarded
	 * to the server via a Google-style `updateMask`; unmentioned
	 * fields are left untouched.
	 *
	 * @param parameters - The universe identifier and the fields to
	 *   update. At least one updatable field must be supplied.
	 * @param options - Optional per-request overrides (e.g. A different
	 *   {@link OpenCloudClientOptions.apiKey} for this call only).
	 * @returns A {@link Result} wrapping the parsed {@link Universe}
	 *   or the {@link OpenCloudError} that caused the request to fail.
	 */
	public async update(
		parameters: UpdateUniverseParameters,
		options?: RequestOptions,
	): Promise<Result<Universe, OpenCloudError>> {
		return this.#inner.execute({ options, parameters, spec: UPDATE_SPEC });
	}
}

function createIconHandle(inner: ResourceClient): UniverseIconHandle {
	return {
		async delete(parameters, options) {
			return inner.execute({ options, parameters, spec: ICON_DELETE_SPEC });
		},
		async list(parameters, options) {
			return inner.execute({ options, parameters, spec: ICON_LIST_SPEC });
		},
		async upload(parameters, options) {
			return inner.execute({ options, parameters, spec: ICON_UPLOAD_SPEC });
		},
	};
}

function createThumbnailsHandle(inner: ResourceClient): UniverseThumbnailsHandle {
	return {
		async delete(parameters, options) {
			return inner.execute({ options, parameters, spec: THUMBNAIL_DELETE_SPEC });
		},
		async reorder(parameters, options) {
			return inner.execute({ options, parameters, spec: THUMBNAIL_REORDER_SPEC });
		},
		async upload(parameters, options) {
			return inner.execute({ options, parameters, spec: THUMBNAIL_UPLOAD_SPEC });
		},
	};
}
