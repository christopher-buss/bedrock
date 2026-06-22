import type { Result } from "@bedrock-rbx/ocale";

import { describe, expectTypeOf, it } from "vitest";

import type { CodegenFile } from "../core/codegen.ts";
import type { CodegenWriteError, CodegenWriterPort } from "./codegen-writer.ts";

describe("CodegenWriterPort.write", () => {
	it("should accept a CodegenFile as its single argument", () => {
		expectTypeOf<Parameters<CodegenWriterPort["write"]>[0]>().toEqualTypeOf<CodegenFile>();
	});

	it("should return Promise<Result<void, CodegenWriteError>>", () => {
		expectTypeOf<ReturnType<CodegenWriterPort["write"]>>().toEqualTypeOf<
			Promise<Result<void, CodegenWriteError>>
		>();
	});
});
