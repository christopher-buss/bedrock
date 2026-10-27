/**
 * The root collections and environment keys inferred while authoring a config.
 */
export interface PricingConfig {
	/**
	 * Environment keys and authored overlay shapes inferred at the call site.
	 */
	readonly environments: Readonly<Record<string, unknown>>;
	/** Root pass entries before the config's public types are applied. */
	readonly passes?: Readonly<Record<string, unknown>>;
	/** Root product entries before the config's public types are applied. */
	readonly products?: Readonly<Record<string, unknown>>;
}

/**
 * Require prices for an inferred overlay; a previously widened Config is
 * checked at load time.
 * @template TConfig - Inferred config root and overlays.
 * @template Environment - Environment key whose effective pricing is checked.
 */
export type ManagedPricingEnvironment<
	TConfig extends PricingConfig,
	Environment extends keyof TConfig["environments"],
> = string extends keyof TConfig["environments"]
	? unknown
	: {
			[Collection in "passes" | "products"]?: CollectionValidation<
				Property<TConfig, Collection>,
				Property<TConfig["environments"][Environment], Collection>
			>;
		};

type Property<T, Key extends PropertyKey> = Key extends keyof T ? T[Key] : undefined;

type RootEntry<Root, Key extends PropertyKey> = Root extends object
	? Key extends keyof Root
		? Root[Key]
		: object
	: object;

type MergedEntry<Root, Overlay> = Overlay & Pick<Root, Exclude<keyof Root, keyof Overlay>>;

type RequiredPrice<Root, Overlay> = [Root] extends [{ readonly retired: "untrack" | true }]
	? unknown
	: [Overlay] extends [{ readonly retired: "untrack" | true }]
		? unknown
		: true extends Property<MergedEntry<Root, Overlay>, "isManagedPricingEnabled">
			? Property<MergedEntry<Root, Overlay>, "price"> extends number
				? unknown
				: { readonly price: number }
			: unknown;

type CollectionValidation<Root, Overlay> = {
	[Key in keyof NonNullable<Overlay>]: RequiredPrice<
		RootEntry<Root, Key>,
		NonNullable<Overlay>[Key]
	>;
};
