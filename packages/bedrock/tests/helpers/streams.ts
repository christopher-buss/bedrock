import { Buffer } from "node:buffer";
import process from "node:process";
import { onTestFinished, vi } from "vitest";

/** Live buffers holding everything written to the captured streams. */
export interface CapturedStreams {
	/** Everything written to `process.stderr` since the capture started. */
	readonly stderr: Array<string>;
	/** Everything written to `process.stdout` since the capture started. */
	readonly stdout: Array<string>;
}

/** Which sinks {@link captureStreams} redirects. */
export interface CaptureOptions {
	/** Also route `console.log` and `console.error` into the buffers. */
	readonly console?: boolean;
}

/**
 * Redirect `process.stdout` and `process.stderr` into arrays for the rest of
 * the current test, restoring both when it finishes. The returned buffers are
 * live, so a test can act first and assert on them last.
 *
 * @param options - Which additional sinks to redirect.
 * @returns The captured `stdout` and `stderr` buffers.
 */
export function captureStreams(options: CaptureOptions = {}): CapturedStreams {
	const stdout: Array<string> = [];
	const stderr: Array<string> = [];
	const restores: Array<() => void> = [
		captureWrite(process.stdout, stdout),
		captureWrite(process.stderr, stderr),
	];
	if (options.console === true) {
		restores.push(captureConsole("log", stdout), captureConsole("error", stderr));
	}

	onTestFinished(() => {
		for (const restore of restores) {
			restore();
		}
	});

	return { stderr, stdout };
}

function captureConsole(method: "error" | "log", sink: Array<string>): () => void {
	const spy = vi
		.spyOn(console, method)
		.mockImplementation((...messages: ReadonlyArray<unknown>) => {
			sink.push(`${messages.map((message) => String(message)).join(" ")}\n`);
		});
	return () => {
		spy.mockRestore();
	};
}

function captureWrite(stream: NodeJS.WriteStream, sink: Array<string>): () => void {
	const spy = vi
		.spyOn(stream, "write")
		.mockImplementation((chunk: string | Uint8Array): boolean => {
			sink.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
			return true;
		});
	return () => {
		spy.mockRestore();
	};
}
