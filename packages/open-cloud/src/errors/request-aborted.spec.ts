import { describe, expect, it } from "vitest";

import { OpenCloudError } from "./base.ts";
import { RequestAbortedError } from "./request-aborted.ts";

describe(RequestAbortedError, () => {
	it("should expose the caller's abort reason as a typed Open Cloud failure", () => {
		expect.assertions(4);

		const reason = new Error("superseded");
		const error = new RequestAbortedError("Request was aborted", { reason });

		expect(error).toBeInstanceOf(OpenCloudError);
		expect(error).toBeInstanceOf(Error);
		expect(error.name).toBe("RequestAbortedError");
		expect(error.reason).toBe(reason);
	});
});
