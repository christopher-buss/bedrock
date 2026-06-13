import type { OpenCloudClientOptions, RequestOptions } from "../../client/types.ts";
import { buildCreateRequest, buildUpdateRequest } from "../../domains/badges/badges/builders.ts";
import {
	CREATE_OPERATION_LIMIT,
	CREATE_REQUIRED_SCOPES,
	UPDATE_OPERATION_LIMIT,
	UPDATE_REQUIRED_SCOPES,
} from "../../domains/badges/badges/operations.ts";
import { parseBadgeResponse } from "../../domains/badges/badges/parsers.ts";
import type {
	Badge,
	CreateBadgeParameters,
	UpdateBadgeParameters,
} from "../../domains/badges/badges/types.ts";
import { buildUploadIconRequest as buildLocaleUploadIconRequest } from "../../domains/game-internationalization/badge-icon/builders.ts";
import type { UploadBadgeIconLocalizationParameters } from "../../domains/game-internationalization/badge-icon/types.ts";
import { buildUpdateRequest as buildLocaleNameDescRequest } from "../../domains/game-internationalization/badge-name-description/builders.ts";
import {
	LOCALIZATION_OPERATION_LIMIT,
	LOCALIZATION_REQUIRED_SCOPES,
} from "../../domains/game-internationalization/badge-name-description/operations.ts";
import type { UpdateBadgeNameDescriptionParameters } from "../../domains/game-internationalization/badge-name-description/types.ts";
import { buildUploadIconRequest } from "../../domains/publish/badge-icon/builders.ts";
import {
	UPLOAD_ICON_OPERATION_LIMIT,
	UPLOAD_ICON_REQUIRED_SCOPES,
} from "../../domains/publish/badge-icon/operations.ts";
import type { UploadBadgeIconParameters } from "../../domains/publish/badge-icon/types.ts";
import type { OpenCloudError } from "../../errors/base.ts";
import { CREATE_METHOD_DEFAULTS, IDEMPOTENT_METHOD_DEFAULTS } from "../../internal/http/retry.ts";
import {
	okRequest,
	parseEmptyResponse,
	ResourceClient,
	type ResourceMethodSpec,
} from "../../internal/resource-client.ts";
import type { Result } from "../../types.ts";

function makeSpec<P, R>(spec: ResourceMethodSpec<P, R>): ResourceMethodSpec<P, R> {
	return Object.freeze(spec);
}

const CREATE_SPEC = makeSpec<CreateBadgeParameters, Badge>({
	buildRequest: (parameters) => okRequest(buildCreateRequest(parameters)),
	methodDefaults: CREATE_METHOD_DEFAULTS,
	methodKind: "create",
	operationLimit: CREATE_OPERATION_LIMIT,
	parse: parseBadgeResponse,
	requiredScopes: CREATE_REQUIRED_SCOPES,
});

const UPDATE_SPEC = makeSpec<UpdateBadgeParameters, undefined>({
	buildRequest: (parameters) => okRequest(buildUpdateRequest(parameters)),
	methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
	methodKind: "idempotent",
	operationLimit: UPDATE_OPERATION_LIMIT,
	parse: parseEmptyResponse,
	requiredScopes: UPDATE_REQUIRED_SCOPES,
});

const UPLOAD_ICON_SPEC = makeSpec<UploadBadgeIconParameters, undefined>({
	buildRequest: (parameters) => okRequest(buildUploadIconRequest(parameters)),
	methodDefaults: CREATE_METHOD_DEFAULTS,
	methodKind: "create",
	operationLimit: UPLOAD_ICON_OPERATION_LIMIT,
	parse: parseEmptyResponse,
	requiredScopes: UPLOAD_ICON_REQUIRED_SCOPES,
});

const UPDATE_NAME_DESCRIPTION_SPEC = makeSpec<UpdateBadgeNameDescriptionParameters, undefined>({
	buildRequest: (parameters) => okRequest(buildLocaleNameDescRequest(parameters)),
	methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
	methodKind: "idempotent",
	operationLimit: LOCALIZATION_OPERATION_LIMIT,
	parse: parseEmptyResponse,
	requiredScopes: LOCALIZATION_REQUIRED_SCOPES,
});

const UPLOAD_LOCALIZED_ICON_SPEC = makeSpec<UploadBadgeIconLocalizationParameters, undefined>({
	buildRequest: (parameters) => okRequest(buildLocaleUploadIconRequest(parameters)),
	methodDefaults: CREATE_METHOD_DEFAULTS,
	methodKind: "create",
	operationLimit: LOCALIZATION_OPERATION_LIMIT,
	parse: parseEmptyResponse,
	requiredScopes: LOCALIZATION_REQUIRED_SCOPES,
});

interface BadgeLocalizationHandle {
	/**
	 * Updates the per-locale display name and/or description registered against
	 * a badge. Either `name`, `description`, or both may be supplied; omitted
	 * fields are not forwarded so the server leaves the existing value for
	 * that locale untouched. Mirrors the upstream `200 OK` echo body as
	 * `undefined` data.
	 *
	 * @param parameters - Badge and language identifiers plus the optional
	 *   replacement values.
	 * @param options - Optional per-request overrides.
	 * @returns A success {@link Result} with no payload, or the
	 *   {@link OpenCloudError} that caused the request to fail.
	 */
	updateNameDescription: (
		parameters: UpdateBadgeNameDescriptionParameters,
		options?: RequestOptions,
	) => Promise<Result<undefined, OpenCloudError>>;
	/**
	 * Uploads or replaces the per-locale icon for a badge. A subsequent
	 * upload for the same `(badgeId, languageCode)` pair replaces the
	 * existing icon for that locale. Does not retry on 5xx so a duplicate
	 * upload cannot be created if the server fails mid-write. Source-language
	 * icons remain on {@link BadgesClient.uploadIcon}.
	 *
	 * No default request timeout applies to this upload; pass `options.timeout`
	 * to set a per-call deadline.
	 *
	 * @param parameters - Badge and language identifiers plus the image bytes
	 *   to upload.
	 * @param options - Optional per-request overrides.
	 * @returns A success {@link Result} with no payload, or the
	 *   {@link OpenCloudError} that caused the request to fail.
	 */
	uploadIcon: (
		parameters: UploadBadgeIconLocalizationParameters,
		options?: RequestOptions,
	) => Promise<Result<undefined, OpenCloudError>>;
}

/**
 * Public client for the Roblox Open Cloud Badges API. Covers programmatic
 * badge creation under a universe, partial updates of badge configuration
 * (`name`, `description`, `enabled`), and source-language icon uploads.
 *
 * Wires the request builders, the injected
 * {@link OpenCloudClientOptions.httpClient}, and response parsers into a
 * single ergonomic surface. Every method returns a {@link Result} so
 * callers handle failure explicitly; no thrown {@link OpenCloudError}
 * ever escapes the client.
 *
 * @example
 *
 * ```ts
 * import { BadgesClient } from "@bedrock-rbx/ocale/badges";
 *
 * const client = new BadgesClient({ apiKey: "your-key" });
 * expect(client).toBeInstanceOf(BadgesClient);
 * ```
 */
export class BadgesClient {
	readonly #inner: ResourceClient;

	/**
	 * Operation Group exposing per-locale localization Operations
	 * (`updateNameDescription`, `uploadIcon`) backed by the
	 * `legacy-game-internationalization` domain. Source-language values
	 * remain on {@link BadgesClient.update} and
	 * {@link BadgesClient.uploadIcon}; methods on this group set per-locale
	 * overlays on top. Shares the parent client's HTTP, rate-limit, and
	 * retry plumbing.
	 */
	public readonly localization: BadgeLocalizationHandle;

	/**
	 * Creates a new {@link BadgesClient}. Configuration is frozen on
	 * construction; per-request overrides are accepted on each method.
	 *
	 * @param options - Client-level configuration including the API key.
	 */
	constructor(options: OpenCloudClientOptions) {
		this.#inner = new ResourceClient(options);
		this.localization = createLocalizationHandle(this.#inner);
	}

	/**
	 * Creates a new badge under the supplied universe.
	 *
	 * No default request timeout applies to this upload; pass `options.timeout`
	 * to set a per-call deadline.
	 *
	 * @param parameters - Creation fields including the universe, name, and
	 *   icon image.
	 * @param options - Optional per-request overrides.
	 * @returns A {@link Result} wrapping the parsed {@link Badge} or the
	 *   {@link OpenCloudError} that caused the request to fail.
	 */
	public async create(
		parameters: CreateBadgeParameters,
		options?: RequestOptions,
	): Promise<Result<Badge, OpenCloudError>> {
		return this.#inner.execute({ options, parameters, spec: CREATE_SPEC });
	}

	/**
	 * Partially updates a badge's configuration. Mirrors the upstream
	 * `200 OK` empty response: a successful update yields `undefined`
	 * data. Only fields explicitly provided are forwarded to the server,
	 * so omitted fields keep their current values.
	 *
	 * @param parameters - Identifier plus the fields to update.
	 * @param options - Optional per-request overrides.
	 * @returns A success {@link Result} with no payload, or the
	 *   {@link OpenCloudError} that caused the request to fail.
	 */
	public async update(
		parameters: UpdateBadgeParameters,
		options?: RequestOptions,
	): Promise<Result<undefined, OpenCloudError>> {
		return this.#inner.execute({ options, parameters, spec: UPDATE_SPEC });
	}

	/**
	 * Uploads or replaces the source-language icon registered against a
	 * badge. A subsequent upload for the same badge replaces the
	 * existing source icon. Does not retry on 5xx so a duplicate icon
	 * upload cannot be created if the server fails mid-write.
	 *
	 * No default request timeout applies to this upload; pass `options.timeout`
	 * to set a per-call deadline.
	 *
	 * @param parameters - Identifier plus the image bytes to upload.
	 * @param options - Optional per-request overrides.
	 * @returns A success {@link Result} with no payload, or the
	 *   {@link OpenCloudError} that caused the request to fail.
	 */
	public async uploadIcon(
		parameters: UploadBadgeIconParameters,
		options?: RequestOptions,
	): Promise<Result<undefined, OpenCloudError>> {
		return this.#inner.execute({ options, parameters, spec: UPLOAD_ICON_SPEC });
	}
}

function createLocalizationHandle(inner: ResourceClient): BadgeLocalizationHandle {
	return {
		async updateNameDescription(parameters, options) {
			return inner.execute({ options, parameters, spec: UPDATE_NAME_DESCRIPTION_SPEC });
		},
		async uploadIcon(parameters, options) {
			return inner.execute({ options, parameters, spec: UPLOAD_LOCALIZED_ICON_SPEC });
		},
	};
}
