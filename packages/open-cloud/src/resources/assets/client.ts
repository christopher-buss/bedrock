import type { OpenCloudClientOptions, RequestOptions } from "../../client/types.ts";
import { buildLocationRequest } from "../../domains/asset-delivery/assets/builders.ts";
import {
	DOWNLOAD_OPERATION_LIMIT,
	DOWNLOAD_REQUIRED_SCOPES,
} from "../../domains/asset-delivery/assets/operations.ts";
import { parseAssetLocationResponse } from "../../domains/asset-delivery/assets/parsers.ts";
import type { DownloadAssetParameters } from "../../domains/asset-delivery/assets/types.ts";
import type { OpenCloudError } from "../../errors/base.ts";
import { IDEMPOTENT_METHOD_DEFAULTS } from "../../internal/http/retry.ts";
import {
	okRequest,
	ResourceClient,
	type ResourceMethodSpec,
} from "../../internal/resource-client.ts";
import type { Result } from "../../types.ts";

/**
 * Options for {@link AssetsClient}: the shared client options plus the
 * `fetch` that downloads content from the signed CDN URL.
 *
 * @since unreleased
 */
export interface AssetsClientOptions extends OpenCloudClientOptions {
	/**
	 * The `fetch` that downloads the stored content from the CDN. It never
	 * receives the credential. Defaults to the global `fetch`.
	 */
	readonly fetch?: FetchFunc;
}

type FetchFunc = (url: string, init: RequestInit) => Promise<Response>;

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

/**
 * Public client for Open Cloud asset delivery. Downloads the content Roblox
 * stores for an asset, which can differ from the uploaded file because
 * Roblox re-encodes uploads.
 *
 * @since unreleased
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
	 * Downloads the stored content of an asset. Resolves the signed CDN
	 * `location` through Open Cloud, then fetches it without the credential.
	 *
	 * @param parameters - The asset to download.
	 * @param options - Optional per-request overrides for the Open Cloud call.
	 * @returns A result containing the stored bytes or the request error.
	 * @since unreleased
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

		const response = await this.#fetch(location.data, {});
		return { data: new Uint8Array(await response.arrayBuffer()), success: true };
	}
}
