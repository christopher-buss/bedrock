import { describe, expectTypeOf, it } from "vitest";

import type { ClackPort } from "./render.ts";
import { createClackPort } from "./render.ts";

describe("ClackPort", () => {
	it("should expose exactly the six clack subset methods", () => {
		expectTypeOf<keyof ClackPort>().toEqualTypeOf<
			"cancel" | "intro" | "logError" | "logMessage" | "logSuccess" | "outro"
		>();
	});

	it("should accept a single string argument on every method and return void", () => {
		expectTypeOf<ClackPort["cancel"]>().toEqualTypeOf<(message: string) => void>();
		expectTypeOf<ClackPort["intro"]>().toEqualTypeOf<(message: string) => void>();
		expectTypeOf<ClackPort["logError"]>().toEqualTypeOf<(message: string) => void>();
		expectTypeOf<ClackPort["logMessage"]>().toEqualTypeOf<(message: string) => void>();
		expectTypeOf<ClackPort["logSuccess"]>().toEqualTypeOf<(message: string) => void>();
		expectTypeOf<ClackPort["outro"]>().toEqualTypeOf<(message: string) => void>();
	});
});

describe(createClackPort, () => {
	it("should return a ClackPort and take no arguments", () => {
		expectTypeOf(createClackPort).toEqualTypeOf<() => ClackPort>();
	});
});
