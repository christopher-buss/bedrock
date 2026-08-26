import type { type } from "arktype";

/**
 * An arktype schema describing the `state` keys one **Backend** adds.
 * Declare only the plugin's own keys; `backend` itself is core's and is
 * merged in for you.
 *
 * @since unreleased
 */
export type StateBackendSchema = type.Any<object>;

/**
 * One **Backend** a plugin claims. `name` is the value users write as
 * `state.backend`, and `schema` declares the keys that may sit alongside
 * it.
 *
 * A name resolves to exactly one declaration: a name already claimed by
 * another loaded plugin, or by a builtin, fails the config load rather
 * than shadowing the existing claim.
 *
 * @since unreleased
 *
 * @example
 *
 * ```ts
 * import type { StateBackendDeclaration } from "@bedrock-rbx/core";
 *
 * import { type } from "arktype";
 *
 * const s3: StateBackendDeclaration = {
 *     name: "s3",
 *     schema: type({ bucket: "string > 0", "region?": "string" }),
 * };
 *
 * expect(s3.name).toBe("s3");
 * ```
 */
export interface StateBackendDeclaration {
	/** Value users write as `state.backend` to select this backend. */
	readonly name: string;
	/** Schema fragment declaring this backend's own `state` keys. */
	readonly schema: StateBackendSchema;
}

/**
 * What a module listed under the config's `plugins` field default-exports.
 * Every field is optional: a plugin contributes only the categories it
 * implements.
 *
 * @since unreleased
 *
 * @example
 *
 * ```ts
 * import type { BedrockPlugin } from "@bedrock-rbx/core";
 *
 * import { type } from "arktype";
 *
 * const plugin: BedrockPlugin = {
 *     stateBackends: [{ name: "s3", schema: type({ bucket: "string > 0" }) }],
 * };
 *
 * expect(plugin.stateBackends).toHaveLength(1);
 * ```
 */
export interface BedrockPlugin {
	/** **Backend**s this plugin claims. */
	readonly stateBackends?: ReadonlyArray<StateBackendDeclaration>;
}
