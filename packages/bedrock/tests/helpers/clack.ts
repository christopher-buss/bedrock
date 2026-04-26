import type { ClackPort } from "#src/cli/render";
import { vi } from "vitest";

/**
 * Build a `ClackPort` whose six methods are independent `vi.fn()` spies. Used
 * by every layer of CLI test (unit, integration, smoke) to assert exactly
 * what was rendered without touching real `@clack/prompts` output.
 *
 * @returns A `ClackPort` whose every method is a fresh `vi.fn()` instance.
 */
export function fakeClackPort(): ClackPort {
	return {
		cancel: vi.fn<ClackPort["cancel"]>(),
		intro: vi.fn<ClackPort["intro"]>(),
		logError: vi.fn<ClackPort["logError"]>(),
		logMessage: vi.fn<ClackPort["logMessage"]>(),
		logSuccess: vi.fn<ClackPort["logSuccess"]>(),
		outro: vi.fn<ClackPort["outro"]>(),
	};
}
