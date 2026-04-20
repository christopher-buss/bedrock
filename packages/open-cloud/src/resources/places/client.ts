import type { OpenCloudClientOptions, RequestOptions } from "../../client/types.ts";
import type { OpenCloudError } from "../../errors/base.ts";
import { CREATE_METHOD_DEFAULTS } from "../../internal/http/retry.ts";
import { ResourceClient, type ResourceMethodSpec } from "../../internal/resource-client.ts";
import type { Result } from "../../types.ts";
import { buildPublishRequest } from "./builders.ts";
import { PUBLISH_OPERATION_LIMIT } from "./operations.ts";
import { parsePublishResponse } from "./parsers.ts";
import type { PlaceVersion, PublishParameters } from "./types.ts";

const PUBLISH_SPEC: ResourceMethodSpec<PublishParameters, PlaceVersion> = Object.freeze({
	buildRequest: (parameters: PublishParameters) => buildPublishRequest(parameters, "Published"),
	methodDefaults: CREATE_METHOD_DEFAULTS,
	methodKind: "create",
	operationLimit: PUBLISH_OPERATION_LIMIT,
	parse: parsePublishResponse,
});

const SAVE_SPEC: ResourceMethodSpec<PublishParameters, PlaceVersion> = Object.freeze({
	buildRequest: (parameters: PublishParameters) => buildPublishRequest(parameters, "Saved"),
	methodDefaults: CREATE_METHOD_DEFAULTS,
	methodKind: "create",
	operationLimit: PUBLISH_OPERATION_LIMIT,
	parse: parsePublishResponse,
});

/**
 * Public client for the Roblox Open Cloud "publish place version"
 * endpoint. Wires the request builder, the injected
 * {@link OpenCloudClientOptions.httpClient}, and the response parser
 * into a single ergonomic surface. Every method returns a {@link Result}
 * so callers handle failure explicitly; no thrown {@link OpenCloudError}
 * ever escapes the client.
 *
 * Publishing or saving a 5xx-failed place version is not retried
 * automatically: Roblox does not support idempotency keys, so a retry
 * could publish a duplicate version unnoticed. Callers that *can* detect
 * duplicates externally may opt back into 5xx retry per-call by passing
 * `retryableStatuses` on the second argument.
 */
export class PlacesClient {
	readonly #inner: ResourceClient;

	/**
	 * Creates a new {@link PlacesClient}. Configuration is frozen on
	 * construction; per-request overrides are accepted on each method.
	 *
	 * @param options - Client-level configuration including the API key.
	 */
	constructor(options: OpenCloudClientOptions) {
		this.#inner = new ResourceClient(options);
	}

	/**
	 * Publishes a new live version of a place.
	 *
	 * @param parameters - Universe and place identifiers, the place file
	 *   bytes, and their declared `format`.
	 * @param options - Optional per-request overrides (e.g. A different
	 *   {@link OpenCloudClientOptions.apiKey} for this call only).
	 * @returns A {@link Result} wrapping the parsed {@link PlaceVersion}
	 *   or the {@link OpenCloudError} that caused the request to fail.
	 */
	public async publish(
		parameters: PublishParameters,
		options?: RequestOptions,
	): Promise<Result<PlaceVersion, OpenCloudError>> {
		return this.#inner.execute({ options, parameters, spec: PUBLISH_SPEC });
	}

	/**
	 * Saves a new draft version of a place. Identical to {@link publish}
	 * except the resulting version is not made live; consumers can list or
	 * promote it later. Shares a single per-API-key rate-limit queue with
	 * `publish` because Roblox attributes both calls to the same per-minute
	 * quota.
	 *
	 * @param parameters - Universe and place identifiers, the place file
	 *   bytes, and their declared `format`.
	 * @param options - Optional per-request overrides (e.g. A different
	 *   {@link OpenCloudClientOptions.apiKey} for this call only).
	 * @returns A {@link Result} wrapping the parsed {@link PlaceVersion}
	 *   or the {@link OpenCloudError} that caused the request to fail.
	 */
	public async save(
		parameters: PublishParameters,
		options?: RequestOptions,
	): Promise<Result<PlaceVersion, OpenCloudError>> {
		return this.#inner.execute({ options, parameters, spec: SAVE_SPEC });
	}
}
