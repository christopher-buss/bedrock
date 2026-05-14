import { fakeClackPort } from "#tests/helpers/clack";
import { describe, expect, it } from "vitest";

import { createClackProgressAdapter } from "./clack-progress-adapter.ts";

describe(createClackProgressAdapter, () => {
	it("should render a deploySuccess event as the existing per-env summary line", () => {
		expect.assertions(2);

		const clack = fakeClackPort();
		const port = createClackProgressAdapter({ clack });

		port.emit({ environment: "production", kind: "deploySuccess", resourceCount: 3 });

		expect(clack.logSuccess).toHaveBeenCalledExactlyOnceWith(
			"production: 3 resources reconciled",
		);
		expect(clack.logError).not.toHaveBeenCalled();
	});

	it("should delegate a deployFailure event to renderDeployError", () => {
		expect.assertions(2);

		const clack = fakeClackPort();
		const port = createClackProgressAdapter({ clack });

		port.emit({
			environment: "ghost",
			error: { declared: ["production"], environment: "ghost", kind: "unknownEnvironment" },
			kind: "deployFailure",
		});

		expect(clack.logError).toHaveBeenCalledExactlyOnceWith(
			"unknown environment 'ghost' (declared: production)",
		);
		expect(clack.logSuccess).not.toHaveBeenCalled();
	});
});
