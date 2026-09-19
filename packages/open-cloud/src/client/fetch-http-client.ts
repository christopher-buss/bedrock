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
 * import {
 *   type DeleteExperienceIconParameters,
 *   UniversesClient,
 * } from "@bedrock-rbx/ocale/universes";
 *
 * const defaultHttpClient = createFetchHttpClient();
 * let observedRequests: ReadonlyArray<HttpRequest> = [];
 * const tracedHttpClient: HttpClient = {
 *   async request(request, config) {
 *     observedRequests = [...observedRequests, request];
 *     return defaultHttpClient.request(request, config);
 *   },
 * };
 * // A data URL keeps this executable example offline. Production clients
 * // normally omit baseUrl and use Ocale's Roblox Open Cloud default.
 * const commonOptions = { apiKey: "your-key", baseUrl: "data:,#" };
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
export const createFetchHttpClient: () => HttpClient = createInternalFetchHttpClient;
