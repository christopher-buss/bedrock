# Plan: `none` sentinel for "off" field values

Status: proposal, not implemented. Replaces the approach in PR #752 (closes
issue #252). Related: #693 (retire resources removed from the config).

## Problem

An env overlay cannot clear a root field. `price: undefined` on a staging
overlay keeps the root price, because the overlay merge (`defu`) skips
`undefined` and `null`. A product cannot go off sale in one environment only.

PR #752 fixes this by making a declared `undefined` win in the merge, and by
converting every YAML/JSON `null` to `undefined` before validation. Problems
with that approach:

1. **Formats disagree.** TS writes `undefined`, YAML/JSON write `null`, Luau
   cannot write anything (a table drops a `nil` key). Luau users must
   restructure the root config.
2. **c12 can drop the clear.** c12 merges `extends` layers (and `$env` blocks)
   with `defu`, which skips `null`/`undefined` keys (`c12/dist/index.mjs:193`,
   `defu.mjs:28`). When an extended layer also declares the same overlay entry,
   the clear disappears silently. The `null`→`undefined` step runs after c12, so
   it cannot recover it. (Found by reading the code, not by a test.)
3. **`undefined` gets a second meaning.** In TS, `undefined` normally means
   "absent". After #752, `price: cond ? 100 : undefined` in an overlay clears
   instead of inheriting.
4. **Global `null` rewrite.** Every `null` in a loaded config becomes
   `undefined`, plugin `state` fragments included.
5. **Hidden existing sentinel.** The root `universe` block already treats a
   declared `undefined` on `privateServerPriceRobux` and the social links as
   "clear on Roblox" (send JSON `null`), and an absent key as "unmanaged"
   (`core/resources.ts`, `core/kinds/universe.ts`). Users cannot see this, and
   Luau cannot express it.

## Proposal

### One meaning per form, in every format

| Written              | Root                                                             | Overlay            |
| -------------------- | ---------------------------------------------------------------- | ------------------ |
| key absent           | Kind default (pass/product price: off sale; universe: unmanaged) | Inherit root value |
| a value              | Set the value                                                    | Set the value      |
| `none`               | Off                                                              | Off                |
| `undefined` / `null` | Validation error, with a hint: use `none`, or remove the key     | Same               |

The kind default differs per kind (see "Products and passes: absent `price`").
The important case is uniform: in an overlay, `none` turns a field off and an
absent key inherits.

`none` is the string `"$none"` on the wire. `@bedrock-rbx/core` exports a typed
constant `none` so TS users do not write the string.

```ts
import { defineConfig, none } from "@bedrock-rbx/core";

export default defineConfig({
	environments: {
		staging: { products: { "gem-pack": { price: none } } },
	},
	products: {
		"gem-pack": { name: "Gem Pack", description: "d", price: 100 },
	},
});
```

```yaml
environments:
  staging:
    products:
      gem-pack: { price: $none }
```

```luau
environments = {
	staging = { products = { ["gem-pack"] = { price = "$none" } } },
},
```

### Which fields accept `none`

Only fields where "no value" is a real "off" state on Roblox:

- Game pass and developer product `price` (off sale).
- Universe `privateServerPriceRobux` (private servers off).
- Universe social links (no link shown).

Boolean fields (`voiceChatEnabled`, ...) reject `none`: their "off" is `false`.
Required fields (`name`, `placeId`) reject it. Open: place `description` /
`displayName`.

### Schema

- Remove `| undefined` from config field schemas (root and overlay). ArkType and
  `exactOptionalPropertyTypes` then reject a present-`undefined` key.
- Add `| '$none'` to the fields above, root and overlay alike.
- Consumers without `exactOptionalPropertyTypes` get no compile error for
  `price: undefined`; they get a load error with the hint (see "Reject
  `null`/`undefined` before c12 drops them").

```ts
const PRICE = "number.integer >= 0 | '$none'";

const developerProductEntry = type({ /* ... */ "price?": PRICE });
const developerProductOverlay = type({ /* ... */ "price?": PRICE });
```

### Merge

`mergeEntry` becomes `{ ...base, ...overlay }`. `none` is an ordinary value, so
it wins over the root value and survives c12's `defu` layer merge. `defu` stays
removed from `select-environment`.

### Translate `none` right after the merge, before redaction

`none` must not reach redaction. `redact-resources.ts` treats every defined
`price` as on sale and substitutes a numeric placeholder: a review reproduced
`price: "$none"` becoming `price: 99999`, which would put an off-sale item on
sale.

So translation runs in `resolveEnvironment`, on the merged config (root entries
included), before `redactAndPrefix` and `collectRealDisplay`. It replaces `none`
with a present-`undefined` key. That shape already means "off" everywhere
downstream: `derivePriceFields` maps it to `isForSale: false`, and the universe
driver sends JSON `null` for `privateServerPriceRobux` and the social links.
Redaction, flatten, diff, drivers, and ocale types do not change.

```ts
// core/none.ts
export const none = "$none";
export type None = typeof none;

export function resolveNone<T extends object>(entry: T): T {
	return Object.fromEntries(
		Object.entries(entry).map(([key, value]) => {
			return [key, value === none ? undefined : value];
		}),
	) as T;
}
```

```ts
// core/select-environment.ts
function resolveNoneInMerged(merged: MergedConfig): MergedConfig {
	return {
		...merged,
		passes: mapValues(merged.passes, resolveNone),
		products: mapValues(merged.products, resolveNone),
		universe: merged.universe && resolveNone(merged.universe),
	};
}

const merged = resolveNoneInMerged(mergeOverlays(config, entry));
```

`mapValues` does not exist in the repo yet. Add a small local helper, or inline
`Object.fromEntries` per kind.

Required test: `price: none` with resource-level and with env-level redaction on
still yields `isForSale: false`, and the real-display map does not record a
price.

### Products and passes: absent `price`

**Decision: keep the Mantle behavior.** An absent root `price` means off sale
(`derive-price-fields.ts`). A pass or product price is always owned by Bedrock.

Rejected alternative: absent `price` = "Bedrock leaves the sale state alone". It
needs a third internal price state (unmanaged / off / number) through flatten,
diff, and request generation, because today the desired state carries
`price: number | undefined` and both drivers map `undefined` to
`isForSale: false`. It also has no meaning at creation: Bedrock must send some
`isForSale` value when it creates a pass or product.

| Root          | Overlay       | Result                  |
| ------------- | ------------- | ----------------------- |
| `price: 100`  | absent        | 100 (inherit)           |
| `price: 100`  | `price: none` | off sale                |
| absent        | absent        | off sale (kind default) |
| `price: none` | absent        | off sale                |

### Reject `null`/`undefined` before c12 drops them

c12 merges `extends` layers with `defu`, which skips `null`/`undefined` keys
(`defu.mjs:28`). An overlay `price: null` in a higher-priority layer, over
`price: 100` in an extended layer, reaches validation as `price: 100`. Schema
tightening alone cannot report it.

Verified with c12 3.3.4: main file sets
`environments.staging.products.gem-pack.price: null` and extends a base with
`price: 100`. The merged config has `price: 100`. `result.layers[0].config` (the
main file) still holds the raw `null`.

A custom c12 `merger` does not help: `defu` skips nullish values before it calls
the merger function.

Instead, scan each raw c12 layer before validation. `c12` returns
`result.layers`, which holds the main config file and every extended layer, each
with its own unmerged config (`c12/dist/index.mjs:196-214`).

c12 `$<env>` / `$env` blocks are out of scope: the root schema rejects
undeclared keys, so a config with a `$staging` key already fails validation. The
scan does not visit `$` keys. Note: when `NODE_ENV` matches the block, c12 also
copies its contents into the layer's top-level sections, so a `null` there would
surface as a nullish error before the undeclared-key error. Run the scan only
when the merged config has no `$` keys, or accept this rare ordering.

Scan only Bedrock resource sections (`passes`, `products`, `places`, `universe`,
and the same under `environments.<name>`), so plugin `state` fragments are not
affected. Flag only keys that are present with `null`/`undefined`, not absent
sections.

```ts
// core/find-nullish.ts (sketch)
const RESOURCE_SECTIONS = ["passes", "products", "places", "universe"] as const;

function findNullishPaths(
	value: JSONValue,
	path: ReadonlyArray<string>,
): Array<string> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return [];
	}

	return Object.entries(value).flatMap(([key, item]) => {
		const itemPath = [...path, key];
		return item === null || item === undefined
			? [itemPath.join(".")]
			: findNullishPaths(item, itemPath);
	});
}
```

```ts
// shell/load-config.ts — after c12, before validation
const nullish = resolved.layers.flatMap((layer) => {
	return findNullishInLayer(layer.config).map((path) => {
		return { path, source: layer.configFile };
	});
});
// error: "products.gem-pack.price is null in base.yaml:
//         write `$none` to turn it off, or remove the key to inherit"
```

The sketch was run against the fixture above. It reports
`environments.staging.products.gem-pack.price`, reports a present
`universe.privateServerPriceRobux: undefined`, returns nothing for absent
sections, and ignores `null` inside plugin `state`.

Required tests: `null` and `undefined` in the main file and in an `extends`
layer; plugin `state` with `null` still loads.

### Ownership: created vs adopted resources

- **Created** resources (passes, products): Bedrock owns every field. An absent
  field gets the kind default on every deploy, so a change made in Creator Hub
  is overwritten. On a created resource, `none` at the root means the same as an
  absent key; it matters in overlays.
- **Adopted** resources (universe, places): Bedrock owns only the declared
  fields. An absent field is not touched.

The two product tri-state flags (`isRegionalPricingEnabled`, `storePageEnabled`)
leave the config instead of getting defaults. Roblox deprecated both on
2026-07-20:

- `isRegionalPricingEnabled`: do not send on product or pass create/update.
  Replaced by `isManagedPricingEnabled`, which is writable on the same endpoints
  (product scope `developer-product:write`).
- `storePageEnabled`: removed from product write and read endpoints. Replaced by
  Shop listing status, which has no documented Open Cloud endpoint (Creator Hub
  only).

Removal is a separate change. A future `isManagedPricingEnabled` field on passes
and products follows the created-resource rule (absent = default).

Defaults (checked 2026-10-23):

| Setting         | Default for API-created items          | Evidence                                                                                                                                                                                                                              |
| --------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Managed pricing | `false` (observed)                     | `isManagedPricingEnabled: false` on all 42 products in the test universe, created through the API without the flag. The docs say new items are enrolled by default, so the API differs from Creator Hub, or the docs are out of date. |
| Shop listing    | product Not Listed; pass always Listed | Shop announcement. Not readable or writable through Open Cloud.                                                                                                                                                                       |

No documented cap on Listed items per universe. The only known cap is 50 game
passes on sale per universe (#691). Under the created-resource rule a priced
pass is pushed on sale on every deploy, so #691 applies on every deploy, not
only on create; the #693 retire step frees slots.

Setting one value for every product needs a config-level defaults block, tracked
in #758.

### Relation to #693 (retire)

Two levels of ownership:

| Level    | Config         | Meaning                                     |
| -------- | -------------- | ------------------------------------------- |
| Resource | entry present  | Bedrock manages the resource                |
| Resource | entry removed  | #693: retire (off sale, rename, drop state) |
| Field    | value / `none` | Bedrock sets the field                      |
| Field    | absent         | Overlay: inherit. Root: kind default        |

Removing a product from the config is a resource-level retire; the user does not
keep an entry with `price: none`. `none` is for a resource that stays managed
but is off (seasonal item, one environment only).

Possible later extension, owned by #693: `none` as a whole overlay entry
(`products: { "gem-pack": none }`) means "this resource does not exist in this
environment", which retires it there.

## Breaking changes

- `undefined`/`null` on a resource field fails at load, in every layer.
- Root universe configs that clear with `undefined` must write `none`.
- Mantle migration emits `none` where it emitted a clearing `undefined`
  (`fold-universe.ts`). Absent pass/product prices stay absent.

## Delivery

New PR; #752 closes in its favor. Change intent: `@bedrock-rbx/core: minor`.

## Open questions

- Do place `description` / `displayName` accept `none`?
- Resource-level `none` in overlays: track on #693?
