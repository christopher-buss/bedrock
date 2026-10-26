import type { PluginEntry, StateBackendDeclaration } from "../core/plugin.ts";
import type { Config, GistStateConfig, PluginStateConfig, WithoutKey } from "../core/schema.ts";
import type { ManagedPricingEnvironment, PricingConfig } from "./managed-pricing-types.ts";

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
 * @since 0.2.3
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
 * @since 0.2.3
 *
 * @template TPlugins - What the config lists under `plugins`.
 * @template TConfig - Inferred root entries and environment overlays, used to check prices.
 */
export type AuthoredConfig<
	TPlugins extends ReadonlyArray<PluginEntry>,
	TConfig extends PricingConfig = Config,
> = AuthoredArms<Config, TPlugins, TConfig>;

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
 * @template TConfig - Inferred root entries and environment overlays.
 */
type AuthoredArm<
	TArm extends Config,
	TPlugins extends ReadonlyArray<PluginEntry>,
	TConfig extends PricingConfig,
> = WithoutKey<TArm, "environments" | "plugins" | "state"> & {
	environments: {
		-readonly [Environment in keyof TConfig["environments"]]: AuthoredEnvironmentEntry<
			TArm["environments"][string],
			AuthoredStateConfig<TPlugins>
		> &
			ManagedPricingEnvironment<TConfig, Environment>;
	};
	plugins?: TPlugins;
	state?: AuthoredStateConfig<TPlugins>;
};

/**
 * Rewrite every arm of the `Config` union independently, so the universeId
 * XOR the arms encode survives into the authored shape.
 *
 * @template TArm - Arm being rewritten, distributed over by the conditional.
 * @template TPlugins - What the config lists under `plugins`.
 * @template TConfig - Inferred root entries and environment overlays.
 */
type AuthoredArms<
	TArm,
	TPlugins extends ReadonlyArray<PluginEntry>,
	TConfig extends PricingConfig,
> = TArm extends Config ? AuthoredArm<TArm, TPlugins, TConfig> : never;

/**
 * Check inferred object keys against the schema, including keyed collections.
 * Arrays retain their existing element contracts, including plugin declarations.
 * @template Shape - Schema that names permitted properties.
 * @template Input - Value captured from the authoring call.
 */
type DeclaredConfigFields<Shape, Input> =
	Input extends ReadonlyArray<unknown>
		? unknown
		: Input extends object
			? Shape extends object
				? {
						[Key in keyof Input]: Key extends keyof Shape
							? DeclaredConfigFields<Shape[Key], Input[Key]>
							: never;
					}
				: never
			: unknown;

/**
 * Inference retains pricing literals; the field guard rejects undeclared keys.
 * @template TPlugins - Plugins deciding which state fields are declared.
 * @template TConfig - Config literal inferred at the call site.
 */
type AuthoredInput<
	TPlugins extends ReadonlyArray<PluginEntry>,
	TConfig extends PricingConfig,
> = AuthoredConfig<TPlugins, NoInfer<TConfig>> &
	DeclaredConfigFields<AuthoredConfig<TPlugins>, NoInfer<TConfig>> &
	TConfig;

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
 * A pass or product with managed pricing enabled needs a price. Root entries
 * enforce this directly; environment overlays may inherit their matching root
 * entry's price or provide their own. Turning managed pricing off permits
 * removing that price with `none`.
 *
 * @since 0.1.0
 *
 * @template TPlugins - Inferred from `plugins`, which decides the `state`
 * blocks the config may write.
 * @template TConfig - Root entries and overlays inferred to check managed pricing.
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
 *             isManagedPricingEnabled: true,
 *             name: "VIP Pass",
 *             price: 500,
 *         },
 *     },
 * });
 *
 * expect(config.passes!["vip-pass"]!.name).toBe("VIP Pass");
 * expect(config.passes!["vip-pass"]!.isManagedPricingEnabled).toBeTrue();
 * ```
 */
export function defineConfig<
	const TPlugins extends ReadonlyArray<PluginEntry> = readonly [],
	const TConfig extends PricingConfig = Config,
>(
	config: (ctx: ConfigContext) => Promise<AuthoredInput<TPlugins, TConfig>>,
): (ctx: ConfigContext) => Promise<AuthoredConfig<TPlugins>>;
export function defineConfig<
	const TPlugins extends ReadonlyArray<PluginEntry> = readonly [],
	const TConfig extends PricingConfig = Config,
>(
	config: (ctx: ConfigContext) => AuthoredInput<TPlugins, TConfig>,
): (ctx: ConfigContext) => AuthoredConfig<TPlugins>;
export function defineConfig<
	const TPlugins extends ReadonlyArray<PluginEntry> = readonly [],
	const TConfig extends PricingConfig = Config,
>(config: AuthoredInput<TPlugins, TConfig>): AuthoredConfig<TPlugins>;
export function defineConfig(config: ConfigInput): ConfigInput {
	return config;
}
