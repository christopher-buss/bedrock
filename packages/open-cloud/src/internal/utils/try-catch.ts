import type { Result } from "../../types";

/**
 * Wraps a promise into a {@link Result}, catching rejections.
 *
 * @template T - The resolved value type.
 * @param promise - The promise to wrap.
 * @returns A Result containing the resolved value or the rejection error.
 */
export async function tryCatch<T>(promise: Promise<T>): Promise<Result<T>> {
	try {
		const data = await promise;
		return { data, success: true };
	} catch (err) {
		return { err: err instanceof Error ? err : new Error(String(err)), success: false };
	}
}
