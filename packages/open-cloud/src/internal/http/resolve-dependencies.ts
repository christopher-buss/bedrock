import { setTimeout } from "node:timers/promises";

import type { HttpClient, SleepFunc } from "../../client/types.ts";
import { createFetchHttpClient } from "./fetch-client.ts";

/**
 * Options accepted by {@link resolveDependencies}. Mirrors the test-seam
 * subset of the public client options.
 */
export interface ResolveDependenciesOptions {
	/** Test seam: custom {@link HttpClient}. Defaults to a fetch-backed client. */
	readonly httpClient?: HttpClient | undefined;
	/** Test seam: custom {@link SleepFunc}. Defaults to a `setTimeout`-backed sleep. */
	readonly sleep?: SleepFunc | undefined;
}

/**
 * Fully-populated dependency set consumed by resource client constructors.
 */
export interface ResolvedDependencies {
	/** Concrete {@link HttpClient} implementation. */
	readonly httpClient: HttpClient;
	/** Concrete {@link SleepFunc} implementation. */
	readonly sleep: SleepFunc;
}

/**
 * Resolves the concrete HTTP client and sleep implementation a resource
 * client should use. Falls back to the fetch-backed HTTP client and the
 * default `setTimeout`-based sleep when the caller omits the test seams.
 *
 * Extracted so resource client constructors can keep their dependency
 * resolution logic in a single, unit-testable place; this makes the
 * default branches easy to cover without stubbing globals like `fetch`.
 *
 * @param options - Optional {@link HttpClient} and {@link SleepFunc} test seams.
 * @returns A {@link ResolvedDependencies} with defaults applied.
 */
export function resolveDependencies(options: ResolveDependenciesOptions): ResolvedDependencies {
	return {
		httpClient: options.httpClient ?? createFetchHttpClient(),
		sleep: options.sleep ?? setTimeout,
	};
}
