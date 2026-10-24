import type { OpenCloudError } from "@bedrock-rbx/ocale";

/**
 * Build an {@link Error} whose `cause` is the error itself.
 *
 * A self-referential cause chain cannot be produced through the `Error`
 * constructor, since the value does not exist until the constructor returns.
 * Walkers that follow `cause` must terminate on one, which is what the tests
 * using this fixture prove.
 *
 * @param message - Text describing what the walker was following.
 * @returns An error whose `cause` points back at itself.
 */
export function cyclicError(message: string): Error {
	const error = new Error(message);
	// eslint-disable-next-line unicorn/no-error-property-assignment -- the cycle is the fixture; no constructor form can express it
	error.cause = error;
	return error;
}

/**
 * Give an Open Cloud error the earlier attempt failures a retried request
 * would have recorded on it, without driving a real retry loop.
 *
 * @template T - The error's own type, kept for the caller.
 * @param error - The failure the retry loop would have returned.
 * @param attempts - Earlier attempt failures, oldest first.
 * @returns The same error, reporting `attempts` as its previous attempts.
 */
export function retriedError<T extends OpenCloudError>(
	error: T,
	attempts: ReadonlyArray<OpenCloudError>,
): T {
	Object.defineProperty(error, "previousAttempts", { value: attempts });
	return error;
}

/**
 * Drop an error's stack so a rendering of it reads as `Name: message`
 * whatever the test runner's call sites are.
 *
 * @template T - The error's own type, kept for the caller.
 * @param error - The error to strip.
 * @returns The same error, with an `undefined` stack.
 */
export function withoutStack<T extends Error>(error: T): T {
	Object.defineProperty(error, "stack", { value: undefined });
	return error;
}
