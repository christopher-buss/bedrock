// Babel wraps this formatter before Vite captures stacks on Error-like objects.
// Bun's native formatter rejects those objects even when they inherit Error.
// Remove when https://github.com/oven-sh/bun/issues/46393 is fixed.
interface StackFrame extends NodeJS.CallSite {
	toString(): string;
}

const nativeFormatter: (error: Error, frames: Array<StackFrame>) => unknown =
	Error.prepareStackTrace.bind(Error);

Error.prepareStackTrace = (error: unknown, frames: Array<StackFrame>) => {
	if (Error.isError(error)) {
		return nativeFormatter(error, frames);
	}

	const stack = frames.map((frame) => `    at ${frame.toString()}`).join("\n");
	return `${String(error)}\n${stack}`;
};
