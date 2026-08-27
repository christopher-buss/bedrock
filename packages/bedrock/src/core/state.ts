import type { ResourceKey, Sha256Hex } from "../types/ids.ts";
import type { ResourceCurrentState, ResourceRealDisplay } from "./resources.ts";

/**
 * In-memory state snapshot for one environment.
 *
 * The on-disk JSON wraps this shape with a `$bedrock: { version: N }` envelope.
 * Adapters flatten the envelope on read and re-wrap it on write; nothing
 * outside an adapter sees the `$bedrock` key.
 *
 * `version` is a literal so a breaking schema change is a compile-time type
 * shift rather than a silently accepted runtime value.
 *
 * @since 0.1.0
 *
 * @example
 *
 * ```ts
 * import {
 *     asResourceKey,
 *     asRobloxAssetId,
 *     asSha256Hex,
 *     type BedrockState,
 * } from "@bedrock-rbx/core";
 *
 * const state: BedrockState = {
 *     environment: "production",
 *     resources: [
 *         {
 *             description: "Grants VIP perks.",
 *             icon: { "en-us": "assets/vip-icon.png" },
 *             iconFileHashes: {
 *                 "en-us": asSha256Hex(
 *                     "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
 *                 ),
 *             },
 *             key: asResourceKey("vip-pass"),
 *             kind: "gamePass",
 *             name: "VIP Pass",
 *             outputs: {
 *                 assetId: asRobloxAssetId("9876543210"),
 *                 iconAssetIds: { "en-us": asRobloxAssetId("1122334455") },
 *             },
 *             price: 500,
 *         },
 *     ],
 *     version: 1,
 * };
 *
 * expect(state.version).toBe(1);
 * expect(state.resources).toHaveLength(1);
 * ```
 */
export interface BedrockState {
	/**
	 * Fingerprint of previously emitted codegen output. Bookkeeping only:
	 * deploys thread the stored value through unchanged and nothing gates on
	 * it. No-op avoidance comes from the place file-hash comparison instead.
	 * The field is omitted entirely until a codegen-enabled deploy first stored
	 * one, so a happy-path snapshot with no codegen never carries it.
	 *
	 * On disk it is stored alongside `version` inside the adapter-private
	 * `$bedrock` envelope; `serializeStateFile` and `parseStateFile` own that
	 * mapping. Like the rebuild marker, it is bedrock bookkeeping and never
	 * participates in drift detection: `diff` and the state merge never read
	 * it.
	 */
	readonly codegenHash?: Sha256Hex;
	/**
	 * Environment name this snapshot belongs to (e.g. `"production"`,
	 * `"staging"`).
	 */
	readonly environment: string;
	/**
	 * Place keys recorded as owing a rebuild, surfaced so a later deploy can
	 * self-heal a place that published but never finished its follow-up build.
	 *
	 * Presence-only: a key is either listed or absent, never flagged `false`.
	 * The field is omitted entirely when no place owes a rebuild, so a
	 * happy-path snapshot never carries it. On disk the set is stored as a list
	 * of keys inside the adapter-private `$bedrock` envelope, and an empty set
	 * is dropped on write. The marker never participates in drift detection.
	 */
	readonly pendingRebuild?: ReadonlySet<ResourceKey>;
	/**
	 * Real (pre-redaction) display values for redacted resources, keyed by the
	 * same `kind:key` composite the diff uses. Populated only for resources
	 * that hide a display field; the field is omitted entirely when no resource
	 * is redacted, so a happy-path snapshot never carries it.
	 *
	 * On disk each entry is co-located as an adapter-private `$realDisplay`
	 * sibling on the resource it describes; `serializeStateFile` and
	 * `parseStateFile` own that mapping. The map never participates in drift
	 * detection: `diff` and the state merge operate on the resources array and
	 * never read it, so persisting real values keeps the diff redaction-blind.
	 * A codegen emitter recovers the values through the `codegenView`
	 * projection.
	 */
	readonly realDisplay?: Readonly<Record<string, ResourceRealDisplay>>;
	/** Current state of every resource Bedrock manages in this environment. */
	readonly resources: ReadonlyArray<ResourceCurrentState>;
	/**
	 * Schema-version literal; bumped only for breaking changes to the on-disk
	 * format.
	 */
	readonly version: 1;
}

/**
 * Which **State** record a write is fenced against: the one a `read`
 * observed, or the absence a `read` observed in its place.
 *
 * `token` is the **Backend**'s own identifier for that exact record - an
 * ETag, a generation number, a revision id - which core carries back to
 * the **Backend** untouched and never parses.
 *
 * The `absent` arm is not the same as carrying no version at all. It says
 * a `read` looked and found nothing, so the write must still fail if a
 * record has appeared since. Carrying no version says the **Backend**
 * cannot fence at all, and the write overwrites whatever is there.
 *
 * @since unreleased
 *
 * @example
 *
 * ```ts
 * import type { StateVersion } from "@bedrock-rbx/core";
 *
 * const firstDeploy: StateVersion = { kind: "absent" };
 * const laterDeploy: StateVersion = { kind: "present", token: '"9f3c1a"' };
 *
 * expect(firstDeploy.kind).toBe("absent");
 *
 * if (laterDeploy.kind === "present") {
 *     expect(laterDeploy.token).toBe('"9f3c1a"');
 * }
 * ```
 */
export type StateVersion =
	| {
			/** Literal discriminator: a record existed when it was read. */
			readonly kind: "present";
			/**
			 * The **Backend**'s own identifier for that record, which core
			 * never parses.
			 */
			readonly token: string;
	  }
	| {
			/** Literal discriminator: no record existed when it was read. */
			readonly kind: "absent";
	  };

/**
 * What one `read` observed: the **State** the store held, and the version
 * naming exactly which record that was.
 *
 * Both fields are absent independently. No `state` is an **Environment**
 * that has never been deployed, which is an ordinary first **Deploy**
 * rather than a failure. No `version` is a **Backend** whose store has no
 * version primitive, so a write built from this record overwrites
 * unconditionally.
 *
 * @since unreleased
 *
 * @example
 *
 * ```ts
 * import type { StateRecord } from "@bedrock-rbx/core";
 *
 * const neverDeployed: StateRecord = { version: { kind: "absent" } };
 * const unfenced: StateRecord = {
 *     state: { environment: "production", resources: [], version: 1 },
 * };
 *
 * expect(neverDeployed.state).toBeUndefined();
 * expect(unfenced.version).toBeUndefined();
 * ```
 */
export interface StateRecord {
	/**
	 * The **State** the record holds, absent when the **Environment** has
	 * never been deployed.
	 */
	readonly state?: BedrockState | undefined;
	/**
	 * Which record was read, absent when the **Backend** cannot fence a
	 * write against it.
	 */
	readonly version?: StateVersion | undefined;
}

/**
 * Fields every {@link StateError} arm carries, whichever **Backend**
 * produced it, so a caller can report the failure without narrowing first.
 *
 * @since unreleased
 */
export interface StateErrorBase {
	/** Adapter-specific path or identifier of the state that failed. */
	readonly file: string;
	/** Human-readable explanation of why the operation could not proceed. */
	readonly reason: string;
}

/**
 * Failure surfaced by a `StatePort`. Plain-data discriminated union; narrow
 * on `kind` rather than using `instanceof`.
 *
 * Every arm carries {@link StateErrorBase}. The arms other than
 * `pluginStateBackend` are backend-neutral, so the same condition reads the
 * same whichever **Backend** produced it:
 *
 * - `stateError` - a state file exists but cannot be trusted: corrupt JSON,
 *   schema failure, or an unknown `$bedrock.version`.
 * - `stateNotFound` - the store the state lives in does not exist. An
 *   environment that has simply never been deployed is `Ok(undefined)` from
 *   `read`, not this.
 * - `stateAccessDenied` - the credential reached the store and was refused.
 * - `stateConflict` - the state changed underneath the operation, so
 *   completing it would clobber a write the caller never saw.
 * - `pluginStateBackend` - a failure only the plugin that produced it can
 *   describe. `specifier` names that plugin and `detail` carries its own
 *   payload verbatim, which core neither reads nor enumerates.
 *
 * @since 0.1.0
 *
 * @example
 *
 * ```ts
 * import type { StateError } from "@bedrock-rbx/core";
 *
 * const err: StateError = {
 *     file: ".bedrock/state/production.json",
 *     kind: "stateError",
 *     reason: "Corrupt JSON: unexpected token at line 1 column 5",
 * };
 *
 * const denied: StateError = {
 *     file: "s3://my-bucket/production.json",
 *     kind: "stateAccessDenied",
 *     reason: "the credential lacks s3:GetObject",
 * };
 *
 * expect(err.kind).toBe("stateError");
 * expect(denied.kind).toBe("stateAccessDenied");
 * ```
 */
export type StateError =
	| (StateErrorBase & {
			/**
			 * The plugin's own failure payload, passed through untouched.
			 * Core treats it as opaque, so narrow it against the shape the
			 * plugin documents.
			 */
			readonly detail: unknown;
			/** Literal discriminator for narrowing. */
			readonly kind: "pluginStateBackend";
			/** Module specifier of the plugin whose **Backend** failed. */
			readonly specifier: string;
	  })
	| (StateErrorBase & {
			/** Literal discriminator for narrowing. */
			readonly kind: "stateAccessDenied";
	  })
	| (StateErrorBase & {
			/** Literal discriminator for narrowing. */
			readonly kind: "stateConflict";
	  })
	| (StateErrorBase & {
			/** Literal discriminator for narrowing. */
			readonly kind: "stateError";
	  })
	| (StateErrorBase & {
			/** Literal discriminator for narrowing. */
			readonly kind: "stateNotFound";
	  });
