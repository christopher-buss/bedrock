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
 * Per-locale name, description, and icon overlays via
 * `legacy-game-internationalization` are out of scope until the umbrella
 * localization work for badges is in place.
 *
 * @example
 *
 * ```ts
 * import { BadgesClient } from "@bedrock/ocale/badges";
 *
 * const client = new BadgesClient({ apiKey: "your-key" });
 * expect(client).toBeInstanceOf(BadgesClient);
 * ```
 */
export class BadgesClient {
	readonly #inner: ResourceClient;

	/**
	 * Creates a new {@link BadgesClient}. Configuration is frozen on
	 * construction; per-request overrides are accepted on each method.
	 *
	 * @param options - Client-level configuration including the API key.
	 */
	constructor(options: OpenCloudClientOptions) {
		this.#inner = new ResourceClient(options);
	}

	/**
	 * Creates a new badge under the supplied universe. Mirrors the upstream
	 * `200 OK` response: a successful create yields the parsed
	 * {@link Badge} as data. Does not retry on 5xx so a duplicate badge
	 * cannot be created if the server fails mid-write.
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
