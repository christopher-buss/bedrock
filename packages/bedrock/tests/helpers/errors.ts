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
