import type { Result } from "@bedrock-rbx/ocale";

import { describe, expectTypeOf, it } from "vitest";

import type { Spawner, SpawnInvocation, SpawnLaunchError } from "./spawner.ts";

describe("Spawner", () => {
	it("should expose a spawn method returning Result<number, SpawnLaunchError>", () => {
		expectTypeOf<Spawner["spawn"]>().toEqualTypeOf<
			(invocation: SpawnInvocation) => Promise<Result<number, SpawnLaunchError>>
		>();
	});

	it("should describe SpawnInvocation as command, args, envOverrides", () => {
		expectTypeOf<SpawnInvocation>().toEqualTypeOf<{
			readonly args: ReadonlyArray<string>;
			readonly command: string;
			readonly envOverrides: Readonly<Record<string, string>>;
		}>();
	});

	it("should tag SpawnLaunchError with the 'launchFailed' kind and an ErrnoException cause", () => {
		expectTypeOf<SpawnLaunchError>().toEqualTypeOf<{
			readonly cause: NodeJS.ErrnoException;
			readonly kind: "launchFailed";
		}>();
	});
});
