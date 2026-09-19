import { createFetchHttpClient as createInternalFetchHttpClient } from "../internal/http/fetch-client.ts";
import type { HttpClient } from "./types.ts";

/**
 * Creates the fetch-backed HTTP transport Ocale uses by default.
 *
 * Wrap the returned transport to add tracing, metrics, recording, or other
 * request-level behavior while retaining Ocale's authentication, timeout,
 * upload, response-parsing, and error-classification semantics.
 *
 * @returns Ocale's default fetch-backed HTTP transport.
 * @since unreleased
 *
 * @example
 *
 * ```ts
 * import {
 *   createFetchHttpClient,
 *   type HttpClient,
 *   type HttpRequest,
 * } from "@bedrock-rbx/ocale";
 * import { UniversesClient } from "@bedrock-rbx/ocale/universes";
 *
 * const defaultHttpClient = createFetchHttpClient();
 * const observedRequests = new Array<HttpRequest>();
 * const tracedHttpClient: HttpClient = {
 *   async request(request, config) {
 *     observedRequests.push(request);
 *     return defaultHttpClient.request(request, config);
 *   },
 * };
 * const client = new UniversesClient({
 *   apiKey: "your-key",
 *   httpClient: tracedHttpClient,
 * });
 * expect(client).toBeInstanceOf(UniversesClient);
 * ```
 */
export const createFetchHttpClient: () => HttpClient = createInternalFetchHttpClient;
