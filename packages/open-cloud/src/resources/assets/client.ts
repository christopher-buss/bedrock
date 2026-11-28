import type { OpenCloudClientOptions, RequestOptions } from "../../client/types.ts";
import { buildLocationRequest } from "../../domains/asset-delivery/assets/builders.ts";
import { decodeAssetContentAsync } from "../../domains/asset-delivery/assets/content.ts";
import {
	DOWNLOAD_OPERATION_LIMIT,
	DOWNLOAD_REQUIRED_SCOPES,
} from "../../domains/asset-delivery/assets/operations.ts";
import { parseAssetLocationResponse } from "../../domains/asset-delivery/assets/parsers.ts";
import type { DownloadAssetParameters } from "../../domains/asset-delivery/assets/types.ts";
import {
	buildCreateImageRequest,
	buildGetIconRequest,
	buildGetRequest,
	buildUpdateIconRequest,
} from "../../domains/assets/assets/builders.ts";
import {
	CREATE_OPERATION_LIMIT,
	GET_ASSET_LIMIT,
	GET_REQUIRED_SCOPES,
	UPDATE_OPERATION_LIMIT,
	WRITE_REQUIRED_SCOPES,
} from "../../domains/assets/assets/operations.ts";
import {
	parseAsset,
	parseAssetIconResponse,
	parseAssetOperationResponse,
	parseAssetResponse,
} from "../../domains/assets/assets/parsers.ts";
import type {
	Asset,
	CreateImageParameters,
	GetAssetParameters,
	UpdateIconParameters,
} from "../../domains/assets/assets/types.ts";
import type { AssetOperation } from "../../domains/assets/assets/wire.ts";
import { ApiError } from "../../errors/api-error.ts";
import type { OpenCloudError } from "../../errors/base.ts";
import { UnexpectedResponseError } from "../../errors/unexpected-response.ts";
import { createRateLimitError } from "../../internal/http/rate-limit-response.ts";
import { requestFailure } from "../../internal/http/request-signal.ts";
import { CREATE_METHOD_DEFAULTS, IDEMPOTENT_METHOD_DEFAULTS } from "../../internal/http/retry.ts";
import type { PollUntilDoneOptions } from "../../internal/polling.ts";
import {
	okRequest,
	ResourceClient,
	type ResourceMethodSpec,
} from "../../internal/resource-client.ts";
import { tryCatchAsync } from "../../internal/utils/try-catch.ts";
import type { Result } from "../../types.ts";
import { finishAssetOperationAsync } from "./operation-polling.ts";

/**
 * Options for {@link AssetsClient}: the shared client options plus the
 * `fetch` that downloads content from the signed CDN URL.
 *
 * @since 0.5.0
 */
export interface AssetsClientOptions extends OpenCloudClientOptions {
	/**
	 * The `fetch` that downloads the stored content from the CDN. It never
	 * receives the credential. Defaults to the global `fetch`.
	 */
	readonly fetch?: (url: string, init: RequestInit) => Promise<Response>;
}

type FetchFunc = NonNullable<AssetsClientOptions["fetch"]>;

const LOCATION_SPEC: ResourceMethodSpec<DownloadAssetParameters, string> = Object.freeze({
	buildRequest: (parameters: DownloadAssetParameters) => {
		return okRequest(buildLocationRequest(parameters));
	},
	methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
	methodKind: "idempotent",
	operationLimit: DOWNLOAD_OPERATION_LIMIT,
	parse: parseAssetLocationResponse,
	requiredScopes: DOWNLOAD_REQUIRED_SCOPES,
});

const GET_SPEC: ResourceMethodSpec<GetAssetParameters, Asset> = Object.freeze({
	buildRequest: (parameters: GetAssetParameters) => okRequest(buildGetRequest(parameters)),
	methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
	methodKind: "idempotent",
	operationLimit: GET_ASSET_LIMIT,
	parse: parseAssetResponse,
	requiredScopes: GET_REQUIRED_SCOPES,
});

const GET_ICON_SPEC: ResourceMethodSpec<GetAssetParameters, string | undefined> = Object.freeze({
	buildRequest: (parameters: GetAssetParameters) => okRequest(buildGetIconRequest(parameters)),
	methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
	methodKind: "idempotent",
	operationLimit: GET_ASSET_LIMIT,
	parse: parseAssetIconResponse,
	requiredScopes: GET_REQUIRED_SCOPES,
});

const CREATE_IMAGE_SPEC: ResourceMethodSpec<CreateImageParameters, AssetOperation> = Object.freeze({
	buildRequest: (parameters: CreateImageParameters) => {
		return okRequest(buildCreateImageRequest(parameters));
	},
	methodDefaults: CREATE_METHOD_DEFAULTS,
	methodKind: "create",
	operationLimit: CREATE_OPERATION_LIMIT,
	parse: parseAssetOperationResponse,
	requiredScopes: WRITE_REQUIRED_SCOPES,
});

const UPDATE_ICON_SPEC: ResourceMethodSpec<UpdateIconParameters, AssetOperation> = Object.freeze({
	buildRequest: (parameters: UpdateIconParameters) => {
		return okRequest(buildUpdateIconRequest(parameters));
	},
	methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
	methodKind: "idempotent",
	operationLimit: UPDATE_OPERATION_LIMIT,
	parse: parseAssetOperationResponse,
	requiredScopes: WRITE_REQUIRED_SCOPES,
});

interface CdnTarget {
	readonly method: string;
	readonly url: string;
}

interface CdnBody {
	readonly bytes: Uint8Array;
	readonly response: Response;
}

/**
 * Public client for Open Cloud assets. Downloads the content Roblox stores
 * for an asset, which can differ from the uploaded file because Roblox
 * re-encodes uploads, and reads an asset's moderation state.
 *
 * @since 0.5.0
 *
 * @example
 *
 * ```ts
 * import { AssetsClient } from "@bedrock-rbx/ocale/assets";
 *
 * const client = new AssetsClient({ credential: { apiKey: "your-key", kind: "apiKey" } });
 * expect(client).toBeInstanceOf(AssetsClient);
 * ```
 */
export class AssetsClient {
	readonly #fetch: FetchFunc;
	readonly #inner: ResourceClient;

	/**
	 * Creates a new {@link AssetsClient}. Configuration is frozen on
	 * construction; per-request overrides are accepted on each method.
	 *
	 * @param options - Client-level configuration including the credential.
	 */
	constructor(options: AssetsClientOptions) {
		this.#inner = new ResourceClient(options);
		this.#fetch = options.fetch ?? fetch;
	}

	/**
	 * Creates an `OpenUse` image asset and polls the operation until it is
	 * done. Any experience can use an `OpenUse` image, so it can be set as a
	 * place icon with no permission grant. Requires the `asset:write` scope,
	 * on an API key or an OAuth token, for the create and for each poll.
	 *
	 * A new image often starts in `Reviewing` moderation. The method does not
	 * wait for moderation.
	 *
	 * No default request timeout applies to the upload; `timeoutMs` bounds
	 * the polling once the upload is accepted.
	 *
	 * @example
	 *
	 * ```ts
	 * import { AssetsClient } from "@bedrock-rbx/ocale/assets";
	 * import { createFakeHttpClient } from "@bedrock-rbx/ocale/testing";
	 *
	 * const operationId = "00000000-0000-0000-0000-000000000001";
	 * const httpClient = createFakeHttpClient()
	 *     .mockResponse({ body: { done: false, operationId }, status: 200 })
	 *     .mockResponse({
	 *         body: {
	 *             done: true,
	 *             operationId,
	 *             response: { assetId: "789", moderationResult: { moderationState: "Reviewing" } },
	 *         },
	 *         status: 200,
	 *     });
	 * const client = new AssetsClient({
	 *     credential: { apiKey: "your-key", kind: "apiKey" },
	 *     httpClient,
	 * });
	 *
	 * const result = client.createImage({
	 *     contentType: "image/png",
	 *     creator: { userId: "111" },
	 *     displayName: "Lobby icon",
	 *     fileContent: new Uint8Array([137, 80, 78, 71]),
	 * });
	 * return expect(result).resolves.toEqual({
	 *     data: { assetId: "789", moderationState: "Reviewing" },
	 *     success: true,
	 * });
	 * ```
	 *
	 * @param parameters - The image file and its owner.
	 * @param options - Optional poll and per-request overrides.
	 * @returns A result containing the new image's ID and moderation state,
	 *   an `AssetOperationError` when the upload failed, or the request error.
	 * @since unreleased
	 */
	public async createImage(
		parameters: CreateImageParameters,
		options: PollUntilDoneOptions = {},
	): Promise<Result<Asset, OpenCloudError>> {
		const started = await this.#inner.executeAsync({
			options,
			parameters,
			spec: CREATE_IMAGE_SPEC,
		});
		if (!started.success) {
			return started;
		}

		const finished = await finishAssetOperationAsync(this.#inner, {
			options,
			started: started.data,
		});
		if (!finished.success) {
			return finished;
		}

		return parseAsset(finished.data.response, finished.data.statusCode);
	}

	/**
	 * Downloads the stored content of an asset. Resolves the signed CDN
	 * `location` through Open Cloud, then fetches it without the credential.
	 *
	 * The `timeout`, `deadlineMs` and retry options apply only to the Open
	 * Cloud call, not to the CDN download. The caller's `signal` cancels both.
	 *
	 * @param parameters - The asset to download.
	 * @param options - Optional per-request overrides for the Open Cloud call.
	 * @returns A result containing the stored bytes or the request error.
	 * @since 0.5.0
	 */
	public async download(
		parameters: DownloadAssetParameters,
		options?: RequestOptions,
	): Promise<Result<Uint8Array, OpenCloudError>> {
		const location = await this.#inner.executeAsync({
			options,
			parameters,
			spec: LOCATION_SPEC,
		});
		if (!location.success) {
			return location;
		}

		return downloadContentAsync(this.#fetch, {
			location: location.data,
			signal: options?.signal,
		});
	}

	/**
	 * Reads an asset's ID and moderation state. Requires the `asset:read`
	 * scope, on an API key or an OAuth token.
	 *
	 * @param parameters - The asset to read.
	 * @param options - Optional per-request overrides.
	 * @returns A result containing the asset or the request error.
	 * @since unreleased
	 */
	public async get(
		parameters: GetAssetParameters,
		options?: RequestOptions,
	): Promise<Result<Asset, OpenCloudError>> {
		return this.#inner.executeAsync({ options, parameters, spec: GET_SPEC });
	}

	/**
	 * Reads the source-language icon of an asset, such as a place. Requires
	 * the `asset:read` scope, on an API key or an OAuth token.
	 *
	 * @param parameters - The asset whose icon to read.
	 * @param options - Optional per-request overrides.
	 * @returns A result containing the image asset ID of the icon, or
	 *   `undefined` when the asset has no icon, or the request error.
	 * @since unreleased
	 */
	public async getIcon(
		parameters: GetAssetParameters,
		options?: RequestOptions,
	): Promise<Result<string | undefined, OpenCloudError>> {
		return this.#inner.executeAsync({ options, parameters, spec: GET_ICON_SPEC });
	}

	/**
	 * Sets or removes the source-language icon of an asset, such as a place,
	 * and polls the operation until it is done. The icon must be an `OpenUse`
	 * image, such as one from {@link AssetsClient.createImage}. Requires the
	 * `asset:write` scope, on an API key or an OAuth token, for the update and
	 * for each poll.
	 *
	 * The operation's result does not show the new icon. Read it back with
	 * {@link AssetsClient.getIcon} when needed.
	 *
	 * @param parameters - The asset, and the image to set as its icon or
	 *   `undefined` to remove the icon.
	 * @param options - Optional poll and per-request overrides.
	 * @returns A success result with no payload, an `AssetOperationError`
	 *   when the update failed, or the request error.
	 * @since unreleased
	 */
	public async updateIcon(
		parameters: UpdateIconParameters,
		options: PollUntilDoneOptions = {},
	): Promise<Result<undefined, OpenCloudError>> {
		const started = await this.#inner.executeAsync({
			options,
			parameters,
			spec: UPDATE_ICON_SPEC,
		});
		if (!started.success) {
			return started;
		}

		const finished = await finishAssetOperationAsync(this.#inner, {
			options,
			started: started.data,
		});
		return finished.success ? { data: undefined, success: true } : finished;
	}
}

/**
 * Rejects content that a redirect moved off HTTPS. The URL in the error keeps
 * only origin and path.
 *
 * @param response - The CDN response, whose `url` is the final URL.
 * @param target - The method of the CDN request.
 * @returns The error, or `undefined` when the final URL is HTTPS.
 */
function insecureRedirectError(
	{ status, url }: Response,
	target: CdnTarget,
): undefined | UnexpectedResponseError {
	if (url === "" || url.startsWith("https:")) {
		return undefined;
	}

	const { origin, pathname } = new URL(url);
	return new UnexpectedResponseError("Asset content was redirected off https", {
		method: target.method,
		statusCode: status,
		url: `${origin}${pathname}`,
	});
}

async function decodeBodyAsync(
	{ bytes, response }: CdnBody,
	target: CdnTarget,
): Promise<Result<Uint8Array, OpenCloudError>> {
	const { status } = response;
	if (status === 429) {
		return { err: createRateLimitError(response, undefined), success: false };
	}

	if (status >= 300) {
		return {
			err: new ApiError(`Asset content download failed with HTTP ${status}`, {
				...target,
				statusCode: status,
			}),
			success: false,
		};
	}

	const decoded = await decodeAssetContentAsync(bytes);
	if (!decoded.success) {
		return {
			err: new UnexpectedResponseError("Asset content is not valid gzip", {
				...target,
				cause: decoded.err,
				statusCode: status,
			}),
			success: false,
		};
	}

	return decoded;
}

/**
 * Whether an error, its stack or any error in its `cause` chain contains the
 * text.
 *
 * @param err - The error to search.
 * @param text - The text to find.
 * @returns `true` when the text appears anywhere in the chain.
 */
function containsText(err: unknown, text: string): boolean {
	let current = err;
	while (current instanceof Error) {
		if (current.message.includes(text) || String(current.stack).includes(text)) {
			return true;
		}

		current = current.cause;
	}

	return false;
}

/**
 * Returns a fetch failure unchanged when the signed URL appears nowhere in
 * its chain, so diagnostics such as `cause.code` survive. Otherwise rebuilds
 * it with the signed URL in its message replaced by the redacted one and a
 * fresh stack, so the signed query cannot reach the message, stack or cause
 * chain.
 *
 * @param err - The fetch failure.
 * @param target - The signed CDN URL and its redacted origin and path.
 * @param target.location - The signed CDN URL.
 * @param target.redacted - The origin and path of the CDN URL.
 * @returns A copy of the failure without the signed URL.
 */
function redactLocation(
	err: Error,
	{ location, redacted }: { readonly location: string; readonly redacted: string },
): Error {
	if (!containsText(err, location)) {
		return err;
	}

	return new Error(err.message.split(location).join(redacted));
}

/**
 * Fetches the signed CDN URL without any credential, reads the body and
 * gunzips it when it is still gzip. The URL in errors keeps only origin and
 * path, and a fetch failure gets a fixed message, so the signed token never
 * leaks into a message or URL.
 *
 * @param fetchFunc - The fetch to send the CDN request through.
 * @param request - The signed CDN URL and the caller's signal, if any.
 * @param request.location - The signed CDN URL.
 * @param request.signal - The caller's cancellation signal, if any.
 * @returns The content bytes, or the typed failure.
 */
async function downloadContentAsync(
	fetchFunc: FetchFunc,
	{ location, signal }: { readonly location: string; readonly signal: AbortSignal | undefined },
): Promise<Result<Uint8Array, OpenCloudError>> {
	const { origin, pathname } = new URL(location);
	const target: CdnTarget = { method: "GET", url: `${origin}${pathname}` };
	const sent = await tryCatchAsync(
		(async (): Promise<CdnBody> => {
			const response = await fetchFunc(location, signal === undefined ? {} : { signal });
			return { bytes: new Uint8Array(await response.arrayBuffer()), response };
		})(),
	);
	if (!sent.success) {
		return {
			err: requestFailure({
				cause: redactLocation(sent.err, { location, redacted: target.url }),
				config: signal === undefined ? {} : { signal },
				effectiveSignal: signal,
				target,
			}),
			success: false,
		};
	}

	const insecure = insecureRedirectError(sent.data.response, target);
	if (insecure !== undefined) {
		return { err: insecure, success: false };
	}

	return decodeBodyAsync(sent.data, target);
}
