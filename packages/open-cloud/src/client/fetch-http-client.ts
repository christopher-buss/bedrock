import { createFetchHttpClient as createInternalFetchHttpClient } from "../internal/http/fetch-client.ts";
import type { HttpClient } from "./types.ts";

/**
 * Creates the fetch-backed HTTP transport Ocale uses by default.
 *
 * Wrap the returned transport to add tracing, metrics, recording, or other
 * request-level behavior while retaining Ocale's authentication, timeout,
 * upload, response-parsing, and error-classification semantics.
 *
 * Pass `fetch` to send through a wrapped or replacement `fetch`. Omit it to
 * use the global `fetch`.
 *
 * @param options - Optional transport settings.
 * @param options.fetch - The `fetch` to send requests through.
 * @returns Ocale's default fetch-backed HTTP transport.
 * @since 0.3.1
 *
 * @example
 *
 * ```ts
 * import {
 *   createFetchHttpClient,
 *   type HttpClient,
 *   type HttpRequest,
 * } from "@bedrock-rbx/ocale";
 * import {
 *   type DeleteExperienceIconParameters,
 *   UniversesClient,
 * } from "@bedrock-rbx/ocale/universes";
 *
 * // An injected response keeps this executable example offline.
 * // Omit fetch in production to use the runtime's global fetch.
 * const defaultHttpClient = createFetchHttpClient({
 *   fetch: async () => new Response(),
 * });
 * let observedRequests: ReadonlyArray<HttpRequest> = [];
 * const tracedHttpClient: HttpClient = {
 *   async request(request, config) {
 *     observedRequests = [...observedRequests, request];
 *     return defaultHttpClient.request(request, config);
 *   },
 * };
 * const commonOptions = {
 *   credential: { apiKey: "your-key", kind: "apiKey" as const },
 * };
 * const client = new UniversesClient({
 *   ...commonOptions,
 *   httpClient: tracedHttpClient,
 * });
 * const undecoratedClient = new UniversesClient({
 *   ...commonOptions,
 *   httpClient: defaultHttpClient,
 * });
 * const parameters: DeleteExperienceIconParameters = {
 *   languageCode: "en",
 *   universeId: "42",
 * };
 * expect(client).toBeInstanceOf(UniversesClient);
 * return Promise.all([
 *   client.icon.delete(parameters),
 *   undecoratedClient.icon.delete(parameters),
 * ]).then(([result, undecoratedResult]) => {
 *   expect(observedRequests).toStrictEqual([{
 *     method: "DELETE",
 *     url: "/legacy-game-internationalization/v1/game-icon/games/42/language-codes/en",
 *   }]);
 *   expect(result).toStrictEqual({ data: undefined, success: true });
 *   expect(result).toStrictEqual(undecoratedResult);
 * });
 * ```
 */
export function createFetchHttpClient(options?: {
	readonly fetch?: (input: string, init: RequestInit) => Promise<Response>;
}): HttpClient {
	return createInternalFetchHttpClient(options?.fetch);
}
