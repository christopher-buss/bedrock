import type { OpenCloudClientOptions, RequestOptions } from "../../client/types.ts";
import { buildUploadIconRequest } from "../../domains/game-internationalization/game-pass-icon/builders.ts";
import type { UploadGamePassIconParameters } from "../../domains/game-internationalization/game-pass-icon/types.ts";
import { buildUpdateRequest as buildLocaleNameDescRequest } from "../../domains/game-internationalization/game-pass-name-description/builders.ts";
import {
	LOCALIZATION_OPERATION_LIMIT,
	LOCALIZATION_REQUIRED_SCOPES,
} from "../../domains/game-internationalization/game-pass-name-description/operations.ts";
import type { UpdateGamePassNameDescriptionParameters } from "../../domains/game-internationalization/game-pass-name-description/types.ts";
import {
	buildCreateRequest,
	buildGetRequest,
	buildListRequest,
	buildUpdateRequest,
} from "../../domains/game-passes/game-passes/builders.ts";
import {
	CREATE_OPERATION_LIMIT,
	CREATE_REQUIRED_SCOPES,
	GET_OPERATION_LIMIT,
	GET_REQUIRED_SCOPES,
	LIST_OPERATION_LIMIT,
	LIST_REQUIRED_SCOPES,
	UPDATE_OPERATION_LIMIT,
	UPDATE_REQUIRED_SCOPES,
} from "../../domains/game-passes/game-passes/operations.ts";
import {
	parseGamePassesListResponse,
	parseGamePassResponse,
} from "../../domains/game-passes/game-passes/parsers.ts";
import type {
	CreateGamePassParameters,
	GamePass,
	GetGamePassParameters,
	ListGamePassesParameters,
	UpdateGamePassParameters,
} from "../../domains/game-passes/game-passes/types.ts";
import type { OpenCloudError } from "../../errors/base.ts";
import { CREATE_METHOD_DEFAULTS, IDEMPOTENT_METHOD_DEFAULTS } from "../../internal/http/retry.ts";
import {
	okRequest,
	parseEmptyResponse,
	ResourceClient,
	type ResourceMethodSpec,
} from "../../internal/resource-client.ts";
import type { Page, Result } from "../../types.ts";

function makeSpec<P, R>(spec: ResourceMethodSpec<P, R>): ResourceMethodSpec<P, R> {
	return Object.freeze(spec);
}

const CREATE_SPEC = makeSpec<CreateGamePassParameters, GamePass>({
	buildRequest: (parameters) => okRequest(buildCreateRequest(parameters)),
	methodDefaults: CREATE_METHOD_DEFAULTS,
	methodKind: "create",
	operationLimit: CREATE_OPERATION_LIMIT,
	parse: parseGamePassResponse,
	requiredScopes: CREATE_REQUIRED_SCOPES,
});

const GET_SPEC = makeSpec<GetGamePassParameters, GamePass>({
	buildRequest: (parameters) => okRequest(buildGetRequest(parameters)),
	methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
	methodKind: "idempotent",
	operationLimit: GET_OPERATION_LIMIT,
	parse: parseGamePassResponse,
	requiredScopes: GET_REQUIRED_SCOPES,
});

const UPDATE_SPEC = makeSpec<UpdateGamePassParameters, undefined>({
	buildRequest: (parameters) => okRequest(buildUpdateRequest(parameters)),
	methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
	methodKind: "idempotent",
	operationLimit: UPDATE_OPERATION_LIMIT,
	parse: parseEmptyResponse,
	requiredScopes: UPDATE_REQUIRED_SCOPES,
});

const LIST_SPEC = makeSpec<ListGamePassesParameters, Page<GamePass>>({
	buildRequest: (parameters) => okRequest(buildListRequest(parameters)),
	methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
	methodKind: "idempotent",
	operationLimit: LIST_OPERATION_LIMIT,
	parse: parseGamePassesListResponse,
	requiredScopes: LIST_REQUIRED_SCOPES,
});

const UPDATE_NAME_DESCRIPTION_SPEC = makeSpec<UpdateGamePassNameDescriptionParameters, undefined>({
	buildRequest: (parameters) => okRequest(buildLocaleNameDescRequest(parameters)),
	methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
	methodKind: "idempotent",
	operationLimit: LOCALIZATION_OPERATION_LIMIT,
	parse: parseEmptyResponse,
	requiredScopes: LOCALIZATION_REQUIRED_SCOPES,
});

const UPLOAD_ICON_SPEC = makeSpec<UploadGamePassIconParameters, undefined>({
	buildRequest: (parameters) => okRequest(buildUploadIconRequest(parameters)),
	methodDefaults: CREATE_METHOD_DEFAULTS,
	methodKind: "create",
	operationLimit: LOCALIZATION_OPERATION_LIMIT,
	parse: parseEmptyResponse,
	requiredScopes: LOCALIZATION_REQUIRED_SCOPES,
});

interface GamePassLocalizationHandle {
	/**
	 * Updates the per-locale display name and/or description registered against
	 * a game pass. Either `name`, `description`, or both may be supplied;
	 * omitted fields are not forwarded so the server leaves the existing value
	 * for that locale untouched. Mirrors the upstream `200 OK` echo body as
	 * `undefined` data.
	 *
	 * @param parameters - Game pass and language identifiers plus the optional
	 *   replacement values.
	 * @param options - Optional per-request overrides.
	 * @returns A success {@link Result} with no payload, or the
	 *   {@link OpenCloudError} that caused the request to fail.
	 */
	updateNameDescription: (
		parameters: UpdateGamePassNameDescriptionParameters,
		options?: RequestOptions,
	) => Promise<Result<undefined, OpenCloudError>>;
	/**
	 * Uploads or replaces the per-locale icon for a game pass. A subsequent
	 * upload for the same `(gamePassId, languageCode)` pair replaces the
	 * existing icon for that locale. Does not retry on 5xx so a duplicate
	 * upload cannot be created if the server fails mid-write.
	 *
	 * @param parameters - Game pass and language identifiers plus the image
	 *   bytes to upload.
	 * @param options - Optional per-request overrides.
	 * @returns A success {@link Result} with no payload, or the
	 *   {@link OpenCloudError} that caused the request to fail.
	 */
	uploadIcon: (
		parameters: UploadGamePassIconParameters,
		options?: RequestOptions,
	) => Promise<Result<undefined, OpenCloudError>>;
}

/**
 * Public client for the Roblox Open Cloud Game Passes API.
 *
 * Wires request builders, the injected {@link OpenCloudClientOptions.httpClient}, and response
 * parsers into a single ergonomic surface. Every method returns a
 * {@link Result} so callers handle failure explicitly; no thrown
 * `OpenCloudError` ever escapes the client.
 *
 * ```ts
 * import { GamePassesClient } from "@bedrock-rbx/ocale/game-passes";
 *
 * const client = new GamePassesClient({ apiKey: process.env.ROBLOX_API_KEY! });
 *
 * const result = await client.get({
 *     universeId: "1234567890",
 *     gamePassId: "9876543210",
 * });
 *
 * if (result.success) {
 *     console.log(`${result.data.name} (${result.data.id})`);
 * } else {
 *     console.error(result.err.message);
 * }
 * ```
 *
 * Listing is cursor-paginated; drive the loop on `nextPageToken`:
 *
 * ```ts
 * let pageToken: string | undefined;
 * do {
 *     const page = await client.list({ universeId: "1234567890", pageToken });
 *     if (!page.success) {
 *         console.error(page.err.message);
 *         break;
 *     }
 *
 *     for (const pass of page.data.items) {
 *         console.log(`${pass.name} (${pass.id})`);
 *     }
 *
 *     pageToken = page.data.nextPageToken;
 * } while (pageToken !== undefined);
 * ```
 */
export class GamePassesClient {
	readonly #inner: ResourceClient;

	/**
	 * Operation Group exposing per-locale localization Operations
	 * (`updateNameDescription`, `uploadIcon`) backed by the
	 * `legacy-game-internationalization` domain. Source-language values
	 * remain on {@link GamePassesClient.update}; methods on this group set
	 * per-locale overlays on top. Shares the parent client's HTTP,
	 * rate-limit, and retry plumbing.
	 */
	public readonly localization: GamePassLocalizationHandle;

	/**
	 * Creates a new {@link GamePassesClient}. Configuration is frozen on
	 * construction; per-request overrides are accepted on each method.
	 *
	 * @param options - Client-level configuration including the API key.
	 */
	constructor(options: OpenCloudClientOptions) {
		this.#inner = new ResourceClient(options);
		this.localization = createLocalizationHandle(this.#inner);
	}

	/**
	 * Creates a new game pass under the supplied universe.
	 *
	 * @param parameters - Creation fields including the universe and pass name.
	 * @param options - Optional per-request overrides.
	 * @returns A {@link Result} wrapping the parsed {@link GamePass} or the
	 *   {@link OpenCloudError} that caused the request to fail.
	 */
	public async create(
		parameters: CreateGamePassParameters,
		options?: RequestOptions,
	): Promise<Result<GamePass, OpenCloudError>> {
		return this.#inner.execute({ options, parameters, spec: CREATE_SPEC });
	}

	/**
	 * Reads a single game pass by ID.
	 *
	 * @param parameters - Universe and game pass identifiers.
	 * @param options - Optional per-request overrides (e.g. A different
	 *   {@link OpenCloudClientOptions.apiKey} for this call only).
	 * @returns A {@link Result} wrapping the parsed {@link GamePass} or the
	 *   {@link OpenCloudError} that caused the request to fail.
	 */
	public async get(
		parameters: GetGamePassParameters,
		options?: RequestOptions,
	): Promise<Result<GamePass, OpenCloudError>> {
		return this.#inner.execute({ options, parameters, spec: GET_SPEC });
	}

	/**
	 * Lists one page of game passes for the supplied universe. Pagination is
	 * cursor-based: omit `pageToken` for the first page, then thread the
	 * previous response's `nextPageToken` back in until it is `undefined`.
	 *
	 * @param parameters - Universe identifier and optional page cursors.
	 * @param options - Optional per-request overrides.
	 * @returns A {@link Result} wrapping a {@link Page} of {@link GamePass},
	 *   or the {@link OpenCloudError} that caused the request to fail.
	 */
	public async list(
		parameters: ListGamePassesParameters,
		options?: RequestOptions,
	): Promise<Result<Page<GamePass>, OpenCloudError>> {
		return this.#inner.execute({ options, parameters, spec: LIST_SPEC });
	}

	/**
	 * Partially updates an existing game pass. Mirrors the upstream
	 * `204 No Content` response: a successful update yields `undefined`
	 * data. Callers that need the post-update state (for example to
	 * observe a server-derived `updatedAt`) chain
	 * {@link GamePassesClient.get} themselves so the GET only fires when
	 * actually needed.
	 *
	 * @param parameters - The universe and game pass identifiers and the
	 *   fields to update. Only fields explicitly provided are forwarded.
	 * @param options - Optional per-request overrides.
	 * @returns A success {@link Result} with no payload, or the
	 *   {@link OpenCloudError} that caused the request to fail.
	 */
	public async update(
		parameters: UpdateGamePassParameters,
		options?: RequestOptions,
	): Promise<Result<undefined, OpenCloudError>> {
		return this.#inner.execute({ options, parameters, spec: UPDATE_SPEC });
	}
}

function createLocalizationHandle(inner: ResourceClient): GamePassLocalizationHandle {
	return {
		async updateNameDescription(parameters, options) {
			return inner.execute({ options, parameters, spec: UPDATE_NAME_DESCRIPTION_SPEC });
		},
		async uploadIcon(parameters, options) {
			return inner.execute({ options, parameters, spec: UPLOAD_ICON_SPEC });
		},
	};
}
