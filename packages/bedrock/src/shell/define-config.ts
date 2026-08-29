import type { PluginEntry, StateBackendDeclaration } from "../core/plugin.ts";
import type { Config, GistStateConfig, PluginStateConfig, WithoutKey } from "../core/schema.ts";

/**
 * Context object passed to a config-function input. Intentionally empty so
 * future fields can be added without breaking existing user configs.
 *
 * @since 0.1.0
 */
export interface ConfigContext {}

/**
 * Every `state` block a config listing `TPlugins` may write.
 *
 * The union closes around the built-in **Backend** and the ones the listed
 * plugins declare, so a misspelled key is an error. A module specifier
 * anywhere in the list reopens it: core cannot check keys it cannot see
 * declared.
 *
 * @since unreleased
 *
 * @template TPlugins - What the config lists under `plugins`.
 */
export type AuthoredStateConfig<TPlugins extends ReadonlyArray<PluginEntry>> =
	| ([Extract<TPlugins[number], string>] extends [never] ? never : PluginStateConfig)
	| GistStateConfig
	| StateOfPlugin<TPlugins[number]>;

/**
 * A `Config` as it is authored, where the `plugins` list is known and the
 * `state` blocks are typed from what it names.
 *
 * `Config` itself describes what `loadConfig` returns, where `plugins` has
 * been resolved to the names of the plugins that loaded.
 *
 * @since unreleased
 *
 * @template TPlugins - What the config lists under `plugins`.
 */
export type AuthoredConfig<TPlugins extends ReadonlyArray<PluginEntry>> = AuthoredArms<
	Config,
	TPlugins
>;

/**
 * Input accepted by `defineConfig`: a config object, or a (sync or async)
 * function that returns one given a `ConfigContext`.
 *
 * @since 0.1.0
 *
 * @template TPlugins - What the config lists under `plugins`, which decides
 * the `state` blocks it may write.
 */
export type ConfigInput<TPlugins extends ReadonlyArray<PluginEntry> = ReadonlyArray<PluginEntry>> =
	| ((ctx: ConfigContext) => AuthoredConfig<TPlugins> | Promise<AuthoredConfig<TPlugins>>)
	| AuthoredConfig<TPlugins>;

/**
 * The `state` block one **Backend** declaration accepts: the `backend` name
 * that selects it, plus the keys its own schema declares.
 *
 * @template TDeclaration - Declaration to read the block off.
 */
type StateOfDeclaration<TDeclaration> =
	TDeclaration extends StateBackendDeclaration<infer TState, infer TName>
		? TState & { readonly backend: TName; readonly locking?: boolean }
		: never;

/**
 * Every `state` block one plugin's **Backend**s accept.
 *
 * @template TPlugin - Plugin to read the declarations off. A module
 * specifier contributes nothing, because core cannot see through a string
 * to what the module declares.
 */
type StateOfPlugin<TPlugin> = TPlugin extends { readonly stateBackends?: infer TBackends }
	? TBackends extends ReadonlyArray<unknown>
		? StateOfDeclaration<TBackends[number]>
		: never
	: never;

/**
 * One entry under `environments`, with its `state` override narrowed to
 * what the listed plugins accept.
 *
 * @template TEntry - Entry shape the `Config` arm declares.
 * @template TState - `state` block the listed plugins accept.
 */
type AuthoredEnvironmentEntry<TEntry extends { state?: unknown }, TState> = WithoutKey<
	TEntry,
	"state"
> & {
	state?: TState;
};

/**
 * One arm of the `Config` union, with every `state` position narrowed to
 * what the listed plugins accept and `plugins` narrowed to the list itself.
 *
 * @template TArm - Arm of the `Config` union being rewritten.
 * @template TPlugins - What the config lists under `plugins`.
 */
type AuthoredArm<TArm extends Config, TPlugins extends ReadonlyArray<PluginEntry>> = WithoutKey<
	TArm,
	"environments" | "plugins" | "state"
> & {
	environments: Record<
		string,
		AuthoredEnvironmentEntry<TArm["environments"][string], AuthoredStateConfig<TPlugins>>
	>;
	plugins?: TPlugins;
	state?: AuthoredStateConfig<TPlugins>;
};

/**
 * Rewrite every arm of the `Config` union independently, so the universeId
 * XOR the arms encode survives into the authored shape.
 *
 * @template TArm - Arm being rewritten, distributed over by the conditional.
 * @template TPlugins - What the config lists under `plugins`.
 */
type AuthoredArms<TArm, TPlugins extends ReadonlyArray<PluginEntry>> = TArm extends Config
	? AuthoredArm<TArm, TPlugins>
	: never;

/**
 * Helper that types a config declared in a `bedrock.config.ts` file
 * against the shape `loadConfig` accepts. Returns its argument unchanged,
 * so `defineConfig(...)` is free at runtime.
 *
 * Accepts a config object or a function that produces one. The function
 * form lets users compute config values from external data at load time;
 * `loadConfig` awaits the result on call.
 *
 * Listing a plugin by value types the `state` block from what that plugin
 * declares, so its keys complete in the editor and a misspelled one is an
 * error. A module specifier leaves the block open, which is what every
 * non-TypeScript config format gets.
 *
 * @since 0.1.0
 *
 * @template TPlugins - Inferred from `plugins`, which decides the `state`
 * blocks the config may write.
 * @param config - Either a config object or a function returning one.
 * @returns The same value, typed as the config shape rather than as the
 * literal that was written, so a field reads back at its declared type.
 * @example
 *
 * ```ts
 * import { defineConfig } from "@bedrock-rbx/core/config";
 *
 * const config = defineConfig({
 *     environments: { production: {} },
 *     passes: {
 *         "vip-pass": {
 *             description: "Grants VIP perks.",
 *             icon: { "en-us": "assets/vip-icon.png" },
 *             name: "VIP Pass",
 *             price: 500,
 *         },
 *     },
 * });
 *
 * expect(config.passes!["vip-pass"]!.name).toBe("VIP Pass");
 * ```
 */
export function defineConfig<const TPlugins extends ReadonlyArray<PluginEntry> = readonly []>(
	config: (ctx: ConfigContext) => Promise<AuthoredConfig<TPlugins>>,
): (ctx: ConfigContext) => Promise<AuthoredConfig<TPlugins>>;
export function defineConfig<const TPlugins extends ReadonlyArray<PluginEntry> = readonly []>(
	config: (ctx: ConfigContext) => AuthoredConfig<TPlugins>,
): (ctx: ConfigContext) => AuthoredConfig<TPlugins>;
export function defineConfig<const TPlugins extends ReadonlyArray<PluginEntry> = readonly []>(
	config: AuthoredConfig<TPlugins>,
): AuthoredConfig<TPlugins>;
export function defineConfig(config: ConfigInput): ConfigInput {
	return config;
}
