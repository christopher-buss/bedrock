import type { StateBackendDeclaration } from "@bedrock-rbx/core";

import { describe, expectTypeOf, it } from "vitest";

import type { bedrockS3Plugin } from "./plugin.ts";
import { s3StateBackend } from "./plugin.ts";
import type { S3StateConfig } from "./state-schema.ts";

describe("s3StateBackend", () => {
	it("should claim the backend name as a literal a config can key on", () => {
		expectTypeOf(s3StateBackend.name).toEqualTypeOf<"s3">();
	});
});

describe("bedrockS3Plugin", () => {
	it("should carry the s3 backend as the tuple a config types its state from", () => {
		expectTypeOf<Required<typeof bedrockS3Plugin>["stateBackends"]>().toEqualTypeOf<
			readonly [StateBackendDeclaration<S3StateConfig, "s3">]
		>();
	});
});
