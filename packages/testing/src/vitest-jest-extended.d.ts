import "jest-extended";

declare module "vitest" {
	interface Matchers<
		R extends Promise<void> | void = Promise<void> | void,
		T = unknown,
	> extends CustomMatchers<R> {}
}
