import { describe, expect, it } from "vitest";

import { readObjectTextAsync } from "./s3-client.ts";

describe(readObjectTextAsync, () => {
	it("should read a body the store never sent as an empty object, not as absent state", async () => {
		expect.assertions(2);

		await expect(readObjectTextAsync(undefined)).resolves.toBe("");
		await expect(
			readObjectTextAsync({ transformToString: async () => '{"stored":true}' }),
		).resolves.toBe('{"stored":true}');
	});
});
