import type { Config } from "../core/schema.ts";

/**
 * Context object passed to a config-function input. Intentionally empty so
 * future ADRs can add fields without breaking existing user configs.
 */
export interface ConfigContext {}

/**
 * Input accepted by `defineConfig`: a plain `Config` object, or a
 * (sync or async) function that returns one given a `ConfigContext`.
 */
export type ConfigInput = ((ctx: ConfigContext) => Config | Promise<Config>) | Config;

/**
 * Identity helper that gives TypeScript users full inference over a config
 * declared in a `bedrock.config.ts` file. Returns its argument unchanged so
 * `defineConfig(...)` is free at runtime.
 *
 * Accepts a plain `Config` object or a function that produces one. The
 * function form lets users compute config values from external data at load
 * time; `loadConfig` awaits the result on call.
 *
 * @template T - Narrow `ConfigInput` subtype preserved across the call so
 * downstream inference does not widen to `Config | (ctx) => Config`.
 * @param config - Either a `Config` literal or a function returning one.
 * @returns The same argument, typed as the narrower `T` so downstream
 * inference does not widen.
 * @example
 *
 * ```ts
 * import { defineConfig } from "@bedrock/core";
 *
 * const config = defineConfig({
 *     environments: { production: {} },
 *     passes: {
 *         "vip-pass": {
 *             description: "Grants VIP perks.",
 *             iconFilePath: "assets/vip-icon.png",
 *             name: "VIP Pass",
 *             price: 500,
 *         },
 *     },
 * });
 *
 * expect(config.passes!["vip-pass"]!.name).toBe("VIP Pass");
 * ```
 */
export function defineConfig<T extends ConfigInput>(config: T): T {
	return config;
}
