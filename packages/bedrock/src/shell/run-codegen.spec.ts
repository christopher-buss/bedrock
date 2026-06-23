import { assert, describe, expect, it, vi } from "vitest";

import { hashCodegenFiles } from "../core/codegen.ts";
import type { CodegenFile, Emitter } from "../core/codegen.ts";
import type { BedrockState, StateError } from "../core/state.ts";
import type { CodegenWriterPort } from "../ports/codegen-writer.ts";
import type { StatePort } from "../ports/state-port.ts";
import { runCodegen } from "./run-codegen.ts";

const PRODUCTION: BedrockState = { environment: "production", resources: [], version: 1 };
const STAGING: BedrockState = { environment: "staging", resources: [], version: 1 };
const FILE: CodegenFile = { content: "return {}\n", path: "ids.luau" };

function inMemoryWriter(): { port: CodegenWriterPort; writes: Array<CodegenFile> } {
	const writes: Array<CodegenFile> = [];
	return {
		port: {
			async write(file) {
				writes.push(file);
				return { data: undefined, success: true };
			},
		},
		writes,
	};
}

function statePortReading(staging: BedrockState | StateError | undefined): StatePort {
	return {
		read: vi.fn<StatePort["read"]>(async (environment) => {
			if (environment === "staging") {
				if (staging !== undefined && "kind" in staging) {
					return { err: staging, success: false };
				}

				return { data: staging, success: true };
			}

			throw new Error(`unexpected read for ${environment}`);
		}),
		write: async () => ({ data: undefined, success: true }),
	};
}

describe(runCodegen, () => {
	it("should hand the emitter the deployed state plus every other environment's last-known state", async () => {
		expect.assertions(1);

		const emit = vi.fn<Emitter>().mockResolvedValue([]);
		const result = await runCodegen({
			deployedState: PRODUCTION,
			emit,
			environments: ["production", "staging"],
			statePort: statePortReading(STAGING),
			writer: inMemoryWriter().port,
		});

		assert(result.success);

		expect(emit).toHaveBeenCalledExactlyOnceWith({
			environments: { production: PRODUCTION, staging: STAGING },
		});
	});

	it("should present a never-deployed environment to the emitter as an empty state", async () => {
		expect.assertions(1);

		const emit = vi.fn<Emitter>().mockResolvedValue([]);
		await runCodegen({
			deployedState: PRODUCTION,
			emit,
			environments: ["production", "staging"],
			statePort: statePortReading(undefined),
			writer: inMemoryWriter().port,
		});

		expect(emit).toHaveBeenCalledExactlyOnceWith({
			environments: {
				production: PRODUCTION,
				staging: { environment: "staging", resources: [], version: 1 },
			},
		});
	});

	it("should use the freshly deployed state instead of re-reading the deployed environment", async () => {
		expect.assertions(1);

		const statePort = statePortReading(STAGING);
		await runCodegen({
			deployedState: PRODUCTION,
			emit: vi.fn<Emitter>().mockResolvedValue([]),
			environments: ["production", "staging"],
			statePort,
			writer: inMemoryWriter().port,
		});

		expect(statePort.read).not.toHaveBeenCalledWith("production");
	});

	it("should write every file the emitter returns through the writer", async () => {
		expect.assertions(1);

		const writer = inMemoryWriter();
		const second: CodegenFile = { content: "return 2\n", path: "more.luau" };
		const result = await runCodegen({
			deployedState: PRODUCTION,
			emit: vi.fn<Emitter>().mockResolvedValue([FILE, second]),
			environments: ["production"],
			statePort: statePortReading(STAGING),
			writer: writer.port,
		});

		assert(result.success);

		expect(writer.writes).toStrictEqual([FILE, second]);
	});

	it("should return the fingerprint of the emitted files on success", async () => {
		expect.assertions(1);

		const second: CodegenFile = { content: "return 2\n", path: "more.luau" };
		const result = await runCodegen({
			deployedState: PRODUCTION,
			emit: vi.fn<Emitter>().mockResolvedValue([FILE, second]),
			environments: ["production"],
			statePort: statePortReading(STAGING),
			writer: inMemoryWriter().port,
		});

		assert(result.success);

		expect(result.data).toBe(await hashCodegenFiles([FILE, second]));
	});

	it("should fail with codegenStateReadFailed when another environment's state cannot be read", async () => {
		expect.assertions(2);

		const error: StateError = {
			file: "staging.json",
			kind: "stateError",
			reason: "corrupt JSON",
		};
		const result = await runCodegen({
			deployedState: PRODUCTION,
			emit: vi.fn<Emitter>().mockResolvedValue([]),
			environments: ["production", "staging"],
			statePort: statePortReading(error),
			writer: inMemoryWriter().port,
		});

		assert(!result.success);
		assert(result.err.kind === "codegenStateReadFailed");

		expect(result.err.environment).toBe("staging");
		expect(result.err.cause).toBe(error);
	});

	it("should fail with codegenEmitThrew when the emitter throws, capturing the message", async () => {
		expect.assertions(1);

		const result = await runCodegen({
			deployedState: PRODUCTION,
			emit: () => {
				throw new Error("emit blew up");
			},
			environments: ["production"],
			statePort: statePortReading(STAGING),
			writer: inMemoryWriter().port,
		});

		assert(!result.success);
		assert(result.err.kind === "codegenEmitThrew");

		expect(result.err.reason).toBe("emit blew up");
	});

	it("should stringify a non-Error emitter rejection into the failure reason", async () => {
		expect.assertions(1);

		const result = await runCodegen({
			deployedState: PRODUCTION,
			emit: vi.fn<Emitter>().mockRejectedValue("kaboom"),
			environments: ["production"],
			statePort: statePortReading(STAGING),
			writer: inMemoryWriter().port,
		});

		assert(!result.success);
		assert(result.err.kind === "codegenEmitThrew");

		expect(result.err.reason).toBe("kaboom");
	});

	it("should fail with codegenWriteFailed when the writer rejects a file", async () => {
		expect.assertions(1);

		const writer: CodegenWriterPort = {
			async write() {
				return {
					err: { kind: "codegenWriteError", path: "ids.luau", reason: "no space" },
					success: false,
				};
			},
		};
		const result = await runCodegen({
			deployedState: PRODUCTION,
			emit: vi.fn<Emitter>().mockResolvedValue([FILE]),
			environments: ["production"],
			statePort: statePortReading(STAGING),
			writer,
		});

		assert(!result.success);
		assert(result.err.kind === "codegenWriteFailed");

		expect(result.err.cause.reason).toBe("no space");
	});
});
