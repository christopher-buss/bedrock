import { NetworkError } from "../../errors/network-error.ts";
import type { RequestAbortedError } from "../../errors/request-aborted.ts";
import { requestAbortedError } from "../utils/abort.ts";
import type { RequestConfig } from "./types.ts";

interface RequestFailureArgs {
	readonly cause: Error;
	readonly config: RequestConfig;
	readonly effectiveSignal: AbortSignal | null | undefined;
	readonly target: { readonly method: string; readonly url: string };
}

/**
 * Composes caller cancellation with Ocale's transport-attempt timeout. The
 * winning signal's reason is retained by `AbortSignal.any`, allowing failure
 * classification to distinguish cancellation from timeout.
 *
 * @param config - Transport configuration for one request.
 * @returns A caller signal, timeout signal, their composition, or `undefined`.
 */
export function requestSignal(config: RequestConfig): AbortSignal | undefined {
	if (config.timeout === undefined) {
		return config.signal;
	}

	const timeout = AbortSignal.timeout(config.timeout);
	return config.signal === undefined ? timeout : AbortSignal.any([config.signal, timeout]);
}

/**
 * Classifies a fetch rejection without confusing a caller abort with the
 * transport's own timeout.
 *
 * @param args - Failure, target, request config, and effective fetch signal.
 * @returns A typed caller cancellation or network failure.
 */
export function requestFailure({
	cause,
	config,
	effectiveSignal,
	target,
}: RequestFailureArgs): NetworkError | RequestAbortedError {
	if (
		config.signal?.aborted === true &&
		effectiveSignal?.aborted === true &&
		Object.is(effectiveSignal.reason, config.signal.reason)
	) {
		return requestAbortedError(config.signal);
	}

	return new NetworkError("Network request failed", {
		cause,
		method: target.method,
		url: target.url,
	});
}
