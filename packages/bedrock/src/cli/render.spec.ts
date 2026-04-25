import { S_BAR, S_BAR_END, S_BAR_START, S_ERROR, S_SUCCESS } from "@clack/prompts";

import { Buffer } from "node:buffer";
import process from "node:process";
import { describe, expect, it, vi } from "vitest";

import { type ClackPort, createClackPort } from "./render.ts";

interface CapturedOutput {
	readonly text: string;
}

function captureWith(act: (port: ClackPort) => void): CapturedOutput {
	const chunks: Array<string> = [];
	const spy = vi
		.spyOn(process.stdout, "write")
		.mockImplementation((chunk: string | Uint8Array): boolean => {
			chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
			return true;
		});

	try {
		act(createClackPort());
	} finally {
		spy.mockRestore();
	}

	return { text: chunks.join("") };
}

describe(createClackPort, () => {
	it("should open a frame with the intro corner symbol", () => {
		expect.assertions(3);

		const { text } = captureWith((port) => {
			port.intro("intro-title");
		});

		expect(text).toContain("intro-title");
		expect(text).toContain(S_BAR_START);
		expect(text).not.toContain(S_BAR_END);
	});

	it("should close a frame with the outro corner symbol after a bar continuation", () => {
		expect.assertions(4);

		const { text } = captureWith((port) => {
			port.outro("outro-message");
		});

		expect(text).toContain("outro-message");
		expect(text).toContain(S_BAR_END);
		expect(text).toContain(S_BAR);
		expect(text).not.toContain(S_BAR_START);
	});

	it("should render a cancel without an active bar continuation", () => {
		expect.assertions(4);

		const { text } = captureWith((port) => {
			port.cancel("cancel-message");
		});

		expect(text).toContain("cancel-message");
		expect(text).toContain(S_BAR_END);
		expect(text).not.toContain(S_BAR);
		expect(text).not.toContain(S_BAR_START);
	});

	it("should render a success line with the success symbol", () => {
		expect.assertions(3);

		const { text } = captureWith((port) => {
			port.logSuccess("success-message");
		});

		expect(text).toContain("success-message");
		expect(text).toContain(S_SUCCESS);
		expect(text).not.toContain(S_ERROR);
	});

	it("should render an error line with the error symbol", () => {
		expect.assertions(3);

		const { text } = captureWith((port) => {
			port.logError("error-message");
		});

		expect(text).toContain("error-message");
		expect(text).toContain(S_ERROR);
		expect(text).not.toContain(S_SUCCESS);
	});

	it("should render a plain message line without success, error, or frame symbols", () => {
		expect.assertions(5);

		const { text } = captureWith((port) => {
			port.logMessage("plain-message");
		});

		expect(text).toContain("plain-message");
		expect(text).toContain(S_BAR);
		expect(text).not.toContain(S_SUCCESS);
		expect(text).not.toContain(S_ERROR);
		expect(text).not.toContain(S_BAR_END);
	});
});
