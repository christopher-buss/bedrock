import { describe, it } from "vitest";

import { PaidSendNotStartedError } from "./paid-send-not-started.ts";

describe(PaidSendNotStartedError, () => {
	it("should name itself and say the paid create was not sent", ({ expect }) => {
		expect.assertions(2);

		const err = new PaidSendNotStartedError();

		expect(err.name).toBe("PaidSendNotStartedError");
		expect(err.message).toBe(
			"The paid badge create was not sent: an Interrupt began before the send",
		);
	});
});
