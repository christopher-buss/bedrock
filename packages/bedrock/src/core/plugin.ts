import type { Result } from "@bedrock-rbx/ocale";

import type { type } from "arktype";

import type { StateLockPort } from "../ports/state-lock-port.ts";
import type { StatePort } from "../ports/state-port.ts";

/**
 * `fetch` seam a **Backend** routes its HTTP through. Adapters take it as an
 * injected dependency rather than reaching for `globalThis.fetch`, so a
 * plugin's own tests drive it against a fake transport the way core's do.
 *
 * @since 0.2.0
 */
export type StateBackendFetch = (
	input: globalThis.Request | string | URL,
	init?: RequestInit,
) => Promise<Response>;

/**
 * An arktype schema describing the `state` keys one **Backend** adds.
 * Declare only the plugin's own keys; `backend` itself is core's and is
 * merged in for you.
 *
 * @since 0.2.0
 *
 * @template TState - Shape the schema validates a `state` block into, which
 * is what the **Backend**'s builder receives.
 */
export type StateBackendSchema<TState extends object = object> = type.Any<TState>;

/**
 * What core hands a **Backend**'s builder. `stateConfig` is the `state`
 * block the user authored, already validated against the plugin's own
 * schema, so the builder reads its keys without re-parsing them.
 *
 * @since 0.2.0
 *
 * @template TState - Shape the plugin's schema validates the `state` block
 * into.
 */
export interface StateBackendContext<TState extends object = object> {
	/**
	 * `fetch` seam, present only when the caller injected one. Adapters that
	 * talk HTTP should route through it and fall back to `globalThis.fetch`,
	 * which is what makes them testable against a fake transport.
	 */
	readonly fetch?: StateBackendFetch | undefined;
	/**
	 * Reads an environment variable. Credentials arrive this way rather than
	 * from `process.env` directly, so a plugin's tests stay free of ambient
	 * process state.
	 */
	readonly getEnv: (name: string) => string | undefined;
	/** The validated `state` block that named this **Backend**. */
	readonly stateConfig: TState;
}

/**
 * Failure a **Backend**'s builder returns when it cannot produce a
 * `StatePort`: a missing credential, a coordinate that does not resolve, a
 * client that refused to construct.
 *
 * Core renders `reason` and passes `detail` through untouched, so a plugin
 * can carry its own typed payload without core enumerating the shapes a
 * **Backend** can fail in.
 *
 * @since 0.2.0
 */
export interface StateBackendBuildError {
	/** The plugin's own payload, which core neither reads nor narrows. */
	readonly detail?: unknown;
	/** Human-readable explanation of why the **Backend** could not build. */
	readonly reason: string;
}

/**
 * One field `bedrock migrate` asks for when a user picks this **Backend**,
 * declared as data so core renders it the way it renders every other
 * prompt.
 *
 * Fields are asked in declaration order. Answers accumulate under their
 * `key`, and each field's `condition` decides against the answers already
 * given whether it is asked at all.
 *
 * @since 0.2.0
 */
export interface StateBackendPromptField {
	/** `state` key the answer is recorded under. */
	readonly key: string;
	/**
	 * Whether to ask this field, given the answers already collected.
	 * Omit to always ask.
	 *
	 * @param answers - Answers to the fields asked before this one, keyed
	 * by their `key`.
	 * @returns `true` to ask the field.
	 */
	readonly condition?: (answers: Readonly<Record<string, string>>) => boolean;
	/** Question shown to the user. */
	readonly label: string;
	/** Example value shown while the field is empty. */
	readonly placeholder?: string;
	/**
	 * What to say when the answer is empty. Supplying it makes the field
	 * required; omitting it lets the user skip through.
	 */
	readonly validationMessage?: string;
}

/**
 * What core hands a **Backend** when it asks the plugin to fetch the
 * foreign state `bedrock migrate` is migrating from.
 *
 * @since 0.2.0
 */
export interface StateBackendSourceContext {
	/** Answers to the source prompts, keyed by field. */
	readonly coordinates: Readonly<Record<string, string>>;
	/**
	 * `fetch` seam, present only when the caller injected one. A reader that
	 * talks HTTP should route through it and fall back to `globalThis.fetch`,
	 * which is what makes it testable against a fake transport on the same
	 * terms a **Backend**'s adapters are.
	 */
	readonly fetch?: StateBackendFetch | undefined;
	/** Reads an environment variable. */
	readonly getEnv: (name: string) => string | undefined;
}

/**
 * How a **Backend** supplies the foreign state `bedrock migrate` reads.
 *
 * The split is bytes versus format: the plugin fetches bytes from
 * coordinates only it understands, and core parses the foreign format. A
 * plugin never learns what another tool's state file means.
 *
 * @since 0.2.0
 *
 * @example
 *
 * ```ts
 * import type { StateBackendMigrateSource } from "@bedrock-rbx/core";
 *
 * const source: StateBackendMigrateSource = {
 *     prompts: [
 *         { key: "bucket", label: "Bucket the Mantle state lives in?" },
 *         { key: "objectKey", label: "Object key of the Mantle state?" },
 *     ],
 *     readBytes: async ({ coordinates, getEnv }) => {
 *         const key = getEnv("AWS_ACCESS_KEY_ID");
 *         if (key === undefined) {
 *             return { err: { reason: "no credentials" }, success: false };
 *         }
 *
 *         return {
 *             data: new TextEncoder().encode(`fetched ${coordinates["objectKey"]}`),
 *             success: true,
 *         };
 *     },
 *     toStateConfig: ({ bucket }) => ({ bucket, prefix: "bedrock/" }),
 * };
 *
 * expect(source.toStateConfig?.({ bucket: "my-bucket" })).toStrictEqual({
 *     bucket: "my-bucket",
 *     prefix: "bedrock/",
 * });
 *
 * return source
 *     .readBytes({
 *         coordinates: { bucket: "my-bucket", objectKey: "state/mantle.yml" },
 *         getEnv: () => "key",
 *     })
 *     .then((fetched) => {
 *         expect(fetched.success).toBeTrue();
 *         if (fetched.success) {
 *             expect(new TextDecoder().decode(fetched.data)).toBe(
 *                 "fetched state/mantle.yml",
 *             );
 *         }
 *     });
 * ```
 */
export interface StateBackendMigrateSource {
	/**
	 * Fields to ask for the coordinates the foreign state lives at, on the
	 * same terms as {@link StateBackendDeclaration.migratePrompts}.
	 */
	readonly prompts: ReadonlyArray<StateBackendPromptField>;
	/**
	 * Fetch the foreign state's bytes.
	 *
	 * @param context - The answered coordinates plus the credential seam
	 * core injects.
	 * @returns `Ok` with the bytes, or `Err` describing why they could not
	 * be fetched.
	 */
	readBytes(
		context: StateBackendSourceContext,
	): Promise<Result<Uint8Array, StateBackendBuildError>>;
	/**
	 * Translate the coordinates the foreign state was read from - the other
	 * tool's state-location config - into the `state` keys bedrock records
	 * for this **Backend**.
	 *
	 * A migration onto this **Backend** records what it returns and asks
	 * none of {@link StateBackendDeclaration.migratePrompts}, so it must
	 * return every key the **Backend**'s schema requires. Omit it when the
	 * place the foreign state lived says nothing about where bedrock's
	 * belongs, and those prompts are asked as usual. Pair it with an
	 * empty `migratePrompts` for a **Backend** the translation fully
	 * describes, which keeps it in the migrate picker.
	 *
	 * @param coordinates - Answers to {@link StateBackendMigrateSource.prompts}.
	 * @returns The `state` keys to record, which core writes `backend`
	 * alongside.
	 */
	toStateConfig?(
		coordinates: Readonly<Record<string, string>>,
	): Readonly<Record<string, unknown>>;
}

/**
 * One **Backend** a plugin claims. `name` is the value users write as
 * `state.backend`, `schema` declares the keys that may sit alongside it,
 * and `createPort` builds the adapter those keys describe.
 *
 * A name resolves to exactly one declaration: a name already claimed by
 * another loaded plugin, or by a builtin, fails the config load rather
 * than shadowing the existing claim.
 *
 * @since 0.2.0
 *
 * @template TState - Shape `schema` validates a `state` block into, which
 * `createPort` then reads without re-parsing.
 *
 * @example
 *
 * ```ts
 * import type { BedrockState, StateBackendDeclaration } from "@bedrock-rbx/core";
 *
 * import { type } from "arktype";
 *
 * const schema = type({ bucket: "string > 0" });
 *
 * const s3: StateBackendDeclaration<typeof schema.infer> = {
 *     name: "s3",
 *     schema,
 *     createPort({ getEnv, stateConfig }) {
 *         const key = getEnv("AWS_ACCESS_KEY_ID");
 *         if (key === undefined) {
 *             return {
 *                 err: { detail: { variable: "AWS_ACCESS_KEY_ID" }, reason: "no credentials" },
 *                 success: false,
 *             };
 *         }
 *
 *         const objects = new Map<string, BedrockState>();
 *         const keyFor = (environment: string) =>
 *             `${stateConfig.bucket}/${environment}.json`;
 *
 *         return {
 *             data: {
 *                 read: async (environment) => {
 *                     const state = objects.get(keyFor(environment));
 *                     return { data: state === undefined ? {} : { state }, success: true };
 *                 },
 *                 write: async (state) => {
 *                     objects.set(keyFor(state.environment), state);
 *                     return { data: undefined, success: true };
 *                 },
 *             },
 *             success: true,
 *         };
 *     },
 * };
 *
 * const built = s3.createPort({
 *     getEnv: () => "example-access-key",
 *     stateConfig: { bucket: "my-bucket" },
 * });
 *
 * expect(s3.name).toBe("s3");
 *
 * if (!built.success) {
 *     throw new Error("unreachable: the credential was supplied");
 * }
 *
 * return built.data
 *     .write({ environment: "production", resources: [], version: 1 })
 *     .then(() => built.data.read("production"))
 *     .then((read) => {
 *         expect(read.success).toBeTrue();
 *         if (read.success) {
 *             expect(read.data.state?.environment).toBe("production");
 *         }
 *     });
 * ```
 */
export interface StateBackendDeclaration<TState extends object = object> {
	/** Value users write as `state.backend` to select this **Backend**. */
	readonly name: string;
	/**
	 * Build the **State lock port** for one validated `state` block.
	 *
	 * Supplying it is how a **Backend** declares that it locks; omitting it
	 * declares that it does not, which is a valid **Backend** that deploys
	 * without exclusion. The declaration is what
	 * {@link "./state-locking".stateLockingCapabilityOf} reports, so
	 * the guarantee is visible before a deploy relies on it.
	 *
	 * @param context - The validated `state` block plus the credential and
	 * transport seams core injects.
	 * @returns `Ok` with the lock port, or `Err` describing why it could not
	 * be built.
	 */
	createLockPort?(
		context: StateBackendContext<TState>,
	): Result<StateLockPort, StateBackendBuildError>;
	/**
	 * Build the adapter for one validated `state` block.
	 *
	 * Returns a `Result` rather than throwing so a missing credential or an
	 * unusable coordinate reaches the user as a typed failure carrying the
	 * plugin's own detail.
	 *
	 * @param context - The validated `state` block plus the credential and
	 * transport seams core injects.
	 * @returns `Ok` with the adapter, or `Err` describing why it could not
	 * be built.
	 */
	createPort(context: StateBackendContext<TState>): Result<StatePort, StateBackendBuildError>;
	/**
	 * Fields `bedrock migrate` asks for when a user migrates onto this
	 * **Backend**, in the order they are asked. Omit to leave the
	 * **Backend** unavailable as a migrate target.
	 */
	readonly migratePrompts?: ReadonlyArray<StateBackendPromptField>;
	/**
	 * How `bedrock migrate` reads the previous tool's state through this
	 * **Backend**. Omit when the foreign state is only ever a local file.
	 */
	readonly migrateSource?: StateBackendMigrateSource;
	/** Schema fragment declaring this **Backend**'s own `state` keys. */
	readonly schema: StateBackendSchema<TState>;
}

/**
 * What a module listed under the config's `plugins` field default-exports.
 * Every field is optional: a plugin contributes only the categories it
 * implements.
 *
 * @since 0.2.0
 *
 * @example
 *
 * ```ts
 * import type { BedrockPlugin } from "@bedrock-rbx/core";
 *
 * import { type } from "arktype";
 *
 * const plugin: BedrockPlugin = {
 *     stateBackends: [
 *         {
 *             name: "s3",
 *             schema: type({ bucket: "string > 0" }),
 *             createPort: () => ({ err: { reason: "not implemented" }, success: false }),
 *         },
 *     ],
 * };
 *
 * expect(plugin.stateBackends).toHaveLength(1);
 * ```
 */
export interface BedrockPlugin {
	/** **Backend**s this plugin claims. */
	readonly stateBackends?: ReadonlyArray<StateBackendDeclaration>;
}
