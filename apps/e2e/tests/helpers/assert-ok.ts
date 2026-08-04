import type { Result } from "@bedrock-rbx/ocale";

import { assert } from "vitest";

/**
 * Assert that a {@link Result} succeeded, narrowing it to its success arm and
 * reporting the whole result in the failure message. Smoke tests run against
 * live Roblox and GitHub APIs, where the error payload is the only clue to why
 * a run failed.
 *
 * @template Data - The success payload type.
 * @template Err - The failure payload type.
 * @param result - The result to check.
 * @param label - What was being attempted, e.g. `loadConfig`.
 */
export function assertOk<Data, Err>(
	result: Result<Data, Err>,
	label: string,
): asserts result is { data: Data; success: true } {
	assert(result.success, `${label} failed: ${JSON.stringify(result)}`);
}
