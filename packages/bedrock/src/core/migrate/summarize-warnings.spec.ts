import { describe, expect, it } from "vitest";

import type { MigrationWarning } from "./migration-report.ts";
import { summarizeWarnings } from "./summarize-warnings.ts";

describe(summarizeWarnings, () => {
	it("should return zero counts for an empty warnings array", () => {
		expect.assertions(1);

		expect(summarizeWarnings([])).toStrictEqual({
			ambiguousCount: 0,
			blockedCount: 0,
			deferredCount: 0,
			interpretiveCount: 0,
		});
	});

	it("should count one warning per kind across a mixed array", () => {
		expect.assertions(1);

		const warnings: ReadonlyArray<MigrationWarning> = [
			{ hint: "h", kind: "ambiguous", mantlePath: "p1" },
			{ kind: "blocked", mantlePath: "p2", reason: "r" },
			{ kind: "deferred", mantlePath: "p3", reason: "r" },
			{ bedrockPath: "b", kind: "interpretive", mantlePath: "p4", rule: "r" },
		];

		expect(summarizeWarnings(warnings)).toStrictEqual({
			ambiguousCount: 1,
			blockedCount: 1,
			deferredCount: 1,
			interpretiveCount: 1,
		});
	});

	it("should accumulate multiple warnings of the same kind", () => {
		expect.assertions(1);

		const warnings: ReadonlyArray<MigrationWarning> = [
			{ kind: "blocked", mantlePath: "p1", reason: "r" },
			{ kind: "blocked", mantlePath: "p2", reason: "r" },
			{ kind: "blocked", mantlePath: "p3", reason: "r" },
		];

		expect(summarizeWarnings(warnings)).toStrictEqual({
			ambiguousCount: 0,
			blockedCount: 3,
			deferredCount: 0,
			interpretiveCount: 0,
		});
	});
});
