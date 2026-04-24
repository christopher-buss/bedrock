import type { Result } from "@bedrock/ocale";

import type { Type } from "arktype";

import type { ResourceKey } from "../../types/ids.ts";
import type { ResourceDesiredInput } from "../flatten.ts";
import type { ResourceCurrentState, ResourceDesiredState, ResourceKind } from "../resources.ts";
import type { Config, ResourceEntryByKind } from "../schema.ts";

/**
 * Failure surfaced during desired-state normalization when the pre-I/O
 * phase for a resource input cannot complete. Validation and key-shape
 * errors are caught upstream by the schema (`validateConfig`); by the time
 * inputs reach a kind module they are already well-formed, so the only
 * remaining failure mode is reading the file bytes the kind depends on.
 *
 * @example
 *
 * ```ts
 * import { asResourceKey, type BuildDesiredError } from "@bedrock/core";
 *
 * const err: BuildDesiredError = {
 *     filePath: "assets/vip-icon.png",
 *     key: asResourceKey("vip-pass"),
 *     kind: "fileReadFailed",
 *     reason: "ENOENT",
 * };
 *
 * expect(err.kind).toBe("fileReadFailed");
 * ```
 */
export interface BuildDesiredError {
	/** ResourceKey of the input whose file failed to read. */
	readonly key: ResourceKey;
	/** Path of the file that failed to read. */
	readonly filePath: string;
	/** Literal discriminator for narrowing. */
	readonly kind: "fileReadFailed";
	/** Human-readable explanation; typically the caught error message. */
	readonly reason: string;
}

/**
 * I/O surface the shell injects into kind-module `normalize` calls. Carries
 * only file-reading capability today; new capabilities widen this shape
 * when a kind module needs them.
 *
 * @example
 *
 * ```ts
 * import type { KindIo } from "@bedrock/core";
 *
 * const io: KindIo = {
 *     readFile: async () => new Uint8Array([1, 2, 3]),
 * };
 *
 * expect(io.readFile).toBeFunction();
 * ```
 */
export interface KindIo {
	/** Reads file bytes for a given path; rejection becomes a `fileReadFailed` Err. */
	readonly readFile: (path: string) => Promise<Uint8Array>;
}

/**
 * Plugin contract for a resource kind: concentrates the per-kind domain
 * surface (authored entry schema, flatten, pre-I/O normalize, drift
 * equality) behind one interface that the core `diff` and shell
 * `buildDesired` functions dispatch through at runtime. Composes with the
 * `ResourceDriver<K>` port, which stays the I/O half of the kind.
 *
 * @template K - The {@link ResourceKind} discriminator this module handles.
 *
 * @example
 *
 * ```ts
 * import { type } from "arktype";
 *
 * import { asResourceKey, asSha256Hex, type ResourceKindModule } from "@bedrock/core";
 *
 * const stubKind: ResourceKindModule<"gamePass"> = {
 *     kind: "gamePass",
 *     entrySchema: type({
 *         description: "string",
 *         iconFilePath: "string",
 *         name: "string",
 *         "price?": "number | undefined",
 *     }),
 *     flatten: () => [],
 *     normalize: async (input) => ({
 *         data: {
 *             description: input.description,
 *             iconFileHash: asSha256Hex(
 *                 "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
 *             ),
 *             iconFilePath: input.iconFilePath,
 *             key: input.key,
 *             kind: "gamePass",
 *             name: input.name,
 *             price: input.price,
 *         },
 *         success: true,
 *     }),
 *     fieldsEqual: (desired, current) => desired.name === current.name,
 * };
 *
 * expect(stubKind.kind).toBe("gamePass");
 * ```
 */
export interface ResourceKindModule<K extends ResourceKind> {
	/** ArkType schema for the authored entry body of this kind. */
	readonly entrySchema: Type<ResourceEntryByKind[K]>;

	/**
	 * Managed-field equality. Identity fields (`key`, `kind`, and kind-specific
	 * inputs like `placeId` or `universeId`) are excluded by the
	 * implementation; `diff` treats `true` as "no drift, emit noop".
	 */
	fieldsEqual(
		desired: Extract<ResourceDesiredState, { kind: K }>,
		current: ResourceCurrentState<K>,
	): boolean;

	/**
	 * Project a validated `Config` into a flat, tagged list of this kind's
	 * pre-I/O inputs. Pure and infallible: the schema has already enforced
	 * every invariant this function relies on.
	 */
	flatten(config: Config): ReadonlyArray<Extract<ResourceDesiredInput, { kind: K }>>;

	/** Discriminator literal for this kind. */
	readonly kind: K;

	/**
	 * Layer pre-I/O work (file reads, hashing) onto an input to produce a
	 * branded desired-state record. Rejections from `io.readFile` are caught
	 * and surfaced as `fileReadFailed`.
	 */
	normalize(
		input: Extract<ResourceDesiredInput, { kind: K }>,
		io: KindIo,
	): Promise<Result<Extract<ResourceDesiredState, { kind: K }>, BuildDesiredError>>;
}
