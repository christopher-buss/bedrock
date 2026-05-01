import type { Result } from "@bedrock/ocale";

import type { Type } from "arktype";

import type { ResourceKey } from "../../types/ids.ts";
import type { ResourceDesiredInput } from "../flatten.ts";
import type { ResourceCurrentState, ResourceDesiredState, ResourceKind } from "../resources.ts";
import type { ResolvedConfig, ResourceEntryByKind } from "../schema.ts";

/**
 * `BuildDesiredError` variant emitted when a kind module's `normalize`
 * cannot read the file bytes it depends on (an icon path, a `.rbxl`
 * source, etc.).
 */
export interface FileReadFailedError {
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
 * `BuildDesiredError` variant emitted when `validatePlan` sees a kind
 * whose prior current state recorded an icon that the desired state no
 * longer declares, on a kind whose upstream API has no documented unset
 * path. Surfaced at plan time so the user gets a clear rejection rather
 * than silent loss of the icon.
 */
export interface IconRemovalRejectedError {
	/** ResourceKey of the entry whose icon is being removed. */
	readonly key: ResourceKey;
	/** Literal discriminator for narrowing. */
	readonly kind: "iconRemovalRejected";
	/** Human-readable explanation naming the resource and the invariant. */
	readonly message: string;
}

/**
 * Failure surfaced during desired-state preparation. Two variants today:
 *
 * - `fileReadFailed`: a kind module's `normalize` could not read a file
 *   the input declared (e.g. An icon path that is missing on disk).
 * - `iconRemovalRejected`: `validatePlan` saw a kind whose prior current
 *   state recorded an icon that the desired state no longer declares,
 *   and the kind has no documented unset path on the upstream API.
 *
 * Both variants carry the offending `key` so the CLI can attribute the
 * failure to a single resource entry.
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
export type BuildDesiredError = FileReadFailedError | IconRemovalRejectedError;

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
 *         icon: type({ "en-us": "string" }).onUndeclaredKey("reject"),
 *         name: "string",
 *         "price?": "number | undefined",
 *     }),
 *     flatten: () => [],
 *     normalize: async (input) => ({
 *         data: {
 *             description: input.description,
 *             icon: input.icon,
 *             iconFileHashes: {
 *                 "en-us": asSha256Hex(
 *                     "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
 *                 ),
 *             },
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
	/**
	 * Optional plan-time invariant check called by `validatePlan` for every
	 * `(kind, key)` pair that exists on both sides. Surfaces kind-specific
	 * rejections (e.g. Removing a developer-product icon, which the upstream
	 * API has no documented unset path for) before any I/O happens. Kinds
	 * without plan-level invariants omit this hook.
	 */
	readonly assertReconcilable?: (
		current: ResourceCurrentState<K>,
		desired: DesiredFor<K>,
	) => Result<undefined, BuildDesiredError>;

	/** ArkType schema for the authored entry body of this kind. */
	readonly entrySchema: Type<ResourceEntryByKind[K]>;

	/**
	 * Managed-field equality. Identity fields (`key`, `kind`, and kind-specific
	 * inputs like `placeId` or `universeId`) are excluded by the
	 * implementation; `diff` treats `true` as "no drift, emit noop".
	 */
	fieldsEqual(desired: DesiredFor<K>, current: ResourceCurrentState<K>): boolean;

	/**
	 * Project a resolved `Config` into a flat, tagged list of this kind's
	 * pre-I/O inputs. Pure and infallible: validation and per-environment
	 * overlay merging have already happened upstream, so every invariant
	 * this function relies on is guaranteed by the input shape.
	 */
	flatten(config: ResolvedConfig): ReadonlyArray<InputFor<K>>;

	/** Discriminator literal for this kind. */
	readonly kind: K;

	/**
	 * Layer pre-I/O work (file reads, hashing) onto an input to produce a
	 * branded desired-state record. Rejections from `io.readFile` are caught
	 * and surfaced as `fileReadFailed`.
	 */
	normalize(input: InputFor<K>, io: KindIo): Promise<Result<DesiredFor<K>, BuildDesiredError>>;
}

/**
 * Polymorphic dispatch table keyed by {@link ResourceKind}, mapping each
 * kind to the {@link ResourceKindModule} that handles its domain surface.
 * Adding a new kind to `ResourceKind` is a compile error at `KindRegistry`
 * until a matching entry is supplied, matching how `DriverRegistry`
 * enforces the same invariant on its I/O half.
 *
 * @example
 *
 * ```ts
 * import { defaultKindRegistry, type KindRegistry } from "@bedrock/core";
 *
 * const registry: KindRegistry = defaultKindRegistry;
 * expect(registry.gamePass.kind).toBe("gamePass");
 * ```
 */
export type KindRegistry = {
	[K in ResourceKind]: ResourceKindModule<K>;
};

/**
 * Desired-state narrowed to a single resource kind.
 *
 * @template K - The resource-kind discriminator.
 */
type DesiredFor<K extends ResourceKind> = Extract<ResourceDesiredState, { readonly kind: K }>;

/**
 * Flat pre-I/O input narrowed to a single resource kind.
 *
 * @template K - The resource-kind discriminator.
 */
type InputFor<K extends ResourceKind> = Extract<ResourceDesiredInput, { readonly kind: K }>;
