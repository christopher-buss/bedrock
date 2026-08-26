import { ArkErrors } from "arktype";
import { describe, expect, it } from "vitest";

import { s3StateSchema } from "./state-schema.ts";

describe(s3StateSchema, () => {
	it("should accept a block naming a bucket and a region", () => {
		expect.assertions(1);

		const parsed = s3StateSchema({ bucket: "my-bucket", region: "eu-west-2" });

		expect(parsed).toStrictEqual({ bucket: "my-bucket", region: "eu-west-2" });
	});

	it("should accept the optional prefix, endpoint, path-style and checksum keys", () => {
		expect.assertions(1);

		const block = {
			bucket: "my-bucket",
			checksumCalculation: "whenRequired",
			endpoint: "https://s3.example.com",
			forcePathStyle: true,
			prefix: "bedrock/state",
			region: "eu-west-2",
		};

		expect(s3StateSchema(block)).toStrictEqual(block);
	});

	it("should reject a block that names no bucket", () => {
		expect.assertions(1);

		const parsed = s3StateSchema({ region: "eu-west-2" });

		expect(parsed).toBeInstanceOf(ArkErrors);
	});

	it("should reject a block that names no region", () => {
		expect.assertions(1);

		const parsed = s3StateSchema({ bucket: "my-bucket" });

		expect(parsed).toBeInstanceOf(ArkErrors);
	});

	it("should reject a bucket that is the empty string", () => {
		expect.assertions(1);

		const parsed = s3StateSchema({ bucket: "", region: "eu-west-2" });

		expect(parsed).toBeInstanceOf(ArkErrors);
	});

	it("should reject a checksum calculation outside the supported pair", () => {
		expect.assertions(1);

		const parsed = s3StateSchema({
			bucket: "my-bucket",
			checksumCalculation: "always",
			region: "eu-west-2",
		});

		expect(parsed).toBeInstanceOf(ArkErrors);
	});
});
