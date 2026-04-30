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

function buildIconUploadSpec(
	parameters: UploadExperienceIconParameters,
): Result<HttpRequest, OpenCloudError> {
	return okRequest(buildUploadIconRequest(parameters));
}

function buildIconDeleteSpec(
	parameters: DeleteExperienceIconParameters,
): Result<HttpRequest, OpenCloudError> {
	return okRequest(buildDeleteIconRequest(parameters));
}

function buildIconListSpec(
	parameters: ListExperienceIconsParameters,
): Result<HttpRequest, OpenCloudError> {
	return okRequest(buildListIconsRequest(parameters));
}

const ICON_UPLOAD_SPEC: ResourceMethodSpec<UploadExperienceIconParameters, undefined> =
	Object.freeze({
		buildRequest: buildIconUploadSpec,
		methodDefaults: CREATE_METHOD_DEFAULTS,
		methodKind: "create",
		operationLimit: ICON_OPERATION_LIMIT,
		parse: parseEmptyResponse,
	});

const ICON_DELETE_SPEC: ResourceMethodSpec<DeleteExperienceIconParameters, undefined> =
	Object.freeze({
		buildRequest: buildIconDeleteSpec,
		methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
		methodKind: "idempotent",
		operationLimit: ICON_OPERATION_LIMIT,
		parse: parseEmptyResponse,
	});

const ICON_LIST_SPEC: ResourceMethodSpec<
	ListExperienceIconsParameters,
	ReadonlyArray<ExperienceIcon>
> = Object.freeze({
	buildRequest: buildIconListSpec,
	methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
	methodKind: "idempotent",
	operationLimit: ICON_OPERATION_LIMIT,
	parse: parseIconListResponse,
});

/**
 * Operation Group exposing the localized experience-icon Operations
 * (`upload`, `delete`, `list`) sourced from the
 * `legacy-game-internationalization` domain. Shares its parent
 * {@link UniversesClient}'s {@link ResourceClient} so rate-limit queues,
 * retries, and per-request overrides flow through one wire surface.
 */
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
 * Localized experience-icon Operations are bound on the
 * {@link UniverseIconHandle} reachable via `client.icon.*` so callers
 * reach for one client per universe.
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
	 * Creates a new {@link UniversesClient}. Configuration is frozen
	 * on construction; per-request overrides are accepted on each
	 * method.
	 *
	 * @param options - Client-level configuration including the API key.
	 */
	constructor(options: OpenCloudClientOptions) {
		this.#inner = new ResourceClient(options);
		this.icon = createIconHandle(this.#inner);
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
