import type { ResourceCurrentState, ResourceRealDisplay } from "./resources.ts";

/**
 * A single redactable display field as presented to a codegen emitter.
 *
 * A non-redacted field is the plain scalar. A redacted field is the object
 * form carrying both the real (pre-redaction) `value` and the `redacted`
 * placeholder bedrock actually pushed to Open Cloud, so an emitter can write
 * the real value into generated game source while still knowing what is live.
 *
 * The polymorphism lives only in this codegen-facing view; the persisted and
 * diffed resource always holds the scalar pushed value. Never hand-narrow the
 * union: use {@link realValue}, {@link pushedValue}, and {@link isRedacted}.
 *
 * @since 0.1.0
 *
 * @template T - The scalar field type (e.g. `string` for a name, `number` for
 * a price).
 */
export type Field<T extends Scalar> = RedactedField<T> | T;

/**
 * The scalar field types a {@link Field} may carry. Constraining the union to
 * scalars keeps `typeof value === "object"` a sound discriminant for the
 * redacted object form: a plain field value can never itself be an object.
 */
type Scalar = boolean | number | string | undefined;

/**
 * Object form of a {@link Field} for a field that was redacted on deploy.
 *
 * @template T - The scalar field type.
 */
interface RedactedField<T extends Scalar> {
	/** The placeholder value bedrock pushed to Open Cloud in place of the real one. */
	readonly redacted: T;
	/** The real (pre-redaction) value recovered from the diff-ignored state sibling. */
	readonly value: T;
}

/**
 * The real (pre-redaction) value of a {@link Field}: the object form's `value`,
 * or the scalar itself when the field was not redacted.
 *
 * @since 0.1.0
 *
 * @template T - The scalar field type.
 * @param field - The field as presented in the codegen view.
 * @returns The real value an emitter should write into generated source.
 *
 * @example
 *
 * ```ts
 * import { realValue } from "@bedrock-rbx/core";
 *
 * expect(realValue("VIP Pass")).toBe("VIP Pass");
 * expect(realValue({ redacted: "Redacted Pass", value: "VIP Pass" })).toBe("VIP Pass");
 * ```
 */
export function realValue<T extends Scalar>(field: Field<T>): T {
	return isRedactedField(field) ? field.value : field;
}

/**
 * The pushed (live) value of a {@link Field}: the object form's `redacted`
 * placeholder, or the scalar itself when the field was not redacted.
 *
 * @since 0.1.0
 *
 * @template T - The scalar field type.
 * @param field - The field as presented in the codegen view.
 * @returns The value currently live on Open Cloud for this field.
 *
 * @example
 *
 * ```ts
 * import { pushedValue } from "@bedrock-rbx/core";
 *
 * expect(pushedValue(500)).toBe(500);
 * expect(pushedValue({ redacted: 99999, value: 500 })).toBe(99999);
 * ```
 */
export function pushedValue<T extends Scalar>(field: Field<T>): T {
	return isRedactedField(field) ? field.redacted : field;
}

/**
 * Whether a {@link Field} was redacted on deploy (its real value differs from
 * the placeholder pushed to Open Cloud).
 *
 * @since 0.1.0
 *
 * @template T - The scalar field type.
 * @param field - The field as presented in the codegen view.
 * @returns `true` for the object form, `false` for a plain scalar.
 *
 * @example
 *
 * ```ts
 * import { isRedacted } from "@bedrock-rbx/core";
 *
 * expect(isRedacted("VIP Pass")).toBeFalse();
 * expect(isRedacted({ redacted: "Redacted Pass", value: "VIP Pass" })).toBeTrue();
 * ```
 */
export function isRedacted<T extends Scalar>(field: Field<T>): boolean {
	return isRedactedField(field);
}

function isRedactedField<T extends Scalar>(field: Field<T>): field is RedactedField<T> {
	// Sound because `T extends Scalar`: a non-redacted field value is never an
	// object, so only the redacted `{ value, redacted }` form is typeof "object".
	return typeof field === "object";
}

/** Redactable scalar fields projected to {@link Field} in a {@link CodegenView}. */
const REDACTABLE_VIEW_FIELDS = ["name", "description", "price", "displayName"] as const;

/**
 * A resource as seen by a codegen emitter: every redactable scalar
 * field is widened to {@link Field}, every other field stays as-is.
 *
 * @since 0.1.0
 *
 * @template Resource - The {@link ResourceCurrentState} shape being projected.
 */
export type CodegenView<Resource> = {
	readonly [Key in keyof Resource]: Key extends RedactableViewField
		? Field<Resource[Key] & Scalar>
		: Resource[Key];
};

type RedactableViewField = (typeof REDACTABLE_VIEW_FIELDS)[number];

/**
 * Project a persisted resource into the view a codegen emitter
 * consumes. A redactable field that was hidden (its key is present in
 * `realDisplay` with a value differing from the pushed scalar) becomes the
 * {@link Field} object form carrying both the real and pushed values. Every
 * other field (non-redactable, or redactable but not hidden) stays the plain
 * scalar already on the resource. The persisted resource is never mutated.
 *
 * Read the projected fields through {@link realValue}, {@link pushedValue}, and
 * {@link isRedacted} rather than narrowing the union by hand.
 *
 * @since 0.1.0
 *
 * @template Resource - The {@link ResourceCurrentState} shape being projected.
 * @param resource - The persisted resource (scalar pushed values).
 * @param realDisplay - The resource's real-display sibling from
 *   `BedrockState.realDisplay`, or `undefined` when nothing was hidden.
 * @returns A view with redactable fields presented as {@link Field}.
 *
 * @example
 *
 * ```ts
 * import {
 *     asResourceKey,
 *     asRobloxAssetId,
 *     asSha256Hex,
 *     codegenView,
 *     realValue,
 *     type ResourceCurrentState,
 * } from "@bedrock-rbx/core";
 *
 * const pass: ResourceCurrentState<"gamePass"> = {
 *     description: "",
 *     icon: { "en-us": "assets/vip-icon.png" },
 *     iconFileHashes: {
 *         "en-us": asSha256Hex(
 *             "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
 *         ),
 *     },
 *     key: asResourceKey("vip-pass"),
 *     kind: "gamePass",
 *     name: "Redacted Pass",
 *     outputs: {
 *         assetId: asRobloxAssetId("9876543210"),
 *         iconAssetIds: { "en-us": asRobloxAssetId("1122334455") },
 *     },
 *     price: 99999,
 * };
 *
 * const view = codegenView(pass, { name: "VIP Pass", price: 500 });
 * expect(realValue(view.name)).toBe("VIP Pass");
 * expect(view.description).toBe("");
 * ```
 */
export function codegenView<Resource extends ResourceCurrentState>(
	resource: Resource,
	realDisplay?: ResourceRealDisplay,
): CodegenView<Resource> {
	const view = REDACTABLE_VIEW_FIELDS.reduce<Record<string, unknown>>(
		(accumulator, field) => {
			if (!(field in resource)) {
				// Skip a field the kind does not own (e.g. a game pass has no
				// `displayName`), even when a mismatched `realDisplay` carries
				// it.
				return accumulator;
			}

			const pushed = accumulator[field];
			const real = realDisplay?.[field];
			return real !== undefined && real !== pushed
				? { ...accumulator, [field]: { redacted: pushed, value: real } }
				: accumulator;
		},
		{ ...resource },
	);

	return view as CodegenView<Resource>;
}
