--!strict
--
-- Luau type-spike for `bedrock.config.luau` type definitions.
--
-- This single file consolidates every encoding pattern explored during the
-- feasibility work that produced ADR-025. Each section is independently
-- demonstrable via `lute check spike.luau` and demonstrates either a
-- chosen pattern or a rejected alternative.
--
-- Open in luau-lsp for inline diagnostics on lines marked "EXPECT ERROR",
-- or run `lute check spike.luau` to see the full diagnostic stream.

-- ============================================================================
-- Reference schema.
--
-- Mirrors `packages/bedrock/src/core/schema.ts` lines 504-585. The two
-- variants encode the universeId XOR via singleton-string directive types
-- on the forbidden side. ADR-025 ships the union DROPPED in favour of a
-- single permissive Config in `packages/bedrock/src/luau/config.luau`; the discriminated
-- variants here exist so the union-encoding alternatives (sections 7-9)
-- can be demonstrated against the schema we would otherwise ship.
-- ============================================================================

type UniverseOverlayForbidId = {
	description: string?,
	displayName: string?,
	universeId: "universeId is already declared on the root universe block; remove it from this environment overlay, or remove it from root and declare it on every environment overlay instead"?,
}

type EnvEntryForbidId = {
	universe: UniverseOverlayForbidId?,
}

type ConfigRootUniverseId = {
	universe: { universeId: string, description: string?, displayName: string? },
	environments: { [string]: EnvEntryForbidId },
}

type UniverseOverlayRequireId = {
	universeId: string,
	description: string?,
	displayName: string?,
}

type EnvEntryRequireId = {
	universe: UniverseOverlayRequireId?,
}

type ConfigEnvironmentUniverseId = {
	universe: {
		universeId: "universeId is already declared per environment; remove it from the root universe block, or remove it from every environment overlay and declare it here instead"?,
		description: string?,
		displayName: string?,
	}?,
	environments: { [string]: EnvEntryRequireId },
}

type Config = ConfigRootUniverseId | ConfigEnvironmentUniverseId

-- ============================================================================
-- Section 1. types.error('msg') -- NOT exposed in the current toolchain.
--
-- The new-solver spec describes `types.error(msg)` as the canonical way to
-- emit a custom diagnostic from a type function. The lute build we have
-- does not expose it; the body fails to parse the key access.
-- ============================================================================

type function _section1_err_via_types(_t: type): type
	return types.error("section 1 diagnostic") -- EXPECT ERROR: Key 'error' not found in table 'typeof(types)'
end

local _section1: _section1_err_via_types<string> = "ok" -- EXPECT ERROR: type function errored at runtime / reduces to never

-- ============================================================================
-- Section 2. Plain error('msg') inside a type function.
--
-- Surfaces at the user's call site, but with "type function errored at
-- runtime" framing -- misleading for a config-shape diagnostic.
-- ============================================================================

type function _section2_err_via_lua(_t: type): type
	error("section 2 directive")
end

local _section2: _section2_err_via_lua<string> = "ok" -- EXPECT ERROR: 'type function errored at runtime: section 2 directive'

-- ============================================================================
-- Section 3. Singleton-string optional. CHOSEN ENCODING.
--
-- The property's type IS the directive string. Any non-nil assignment fails
-- the type check and the literal surfaces verbatim in 'Expected this to be
-- ...'. Two-bullet diagnostic, clean.
-- ============================================================================

type _Section3Forbidden = {
	universeId: "universeId is already declared on the root universe block; remove it from this environment overlay, or remove it from root and declare it on every environment overlay instead"?,
}

local _section3_ok: _Section3Forbidden = {}
local _section3_bad: _Section3Forbidden = { universeId = "123" } -- EXPECT ERROR: directive verbatim in 'Expected this to be ...'

-- ============================================================================
-- Section 4. never? optional (control case, no directive).
--
-- Clean diagnostic but uninformative ('Expected this to be never?'). Shown
-- here as the baseline to compare the singleton-string approach against.
-- ============================================================================

type _Section4Forbidden = { universeId: never? }

local _section4_ok: _Section4Forbidden = {}
local _section4_bad: _Section4Forbidden = { universeId = "123" } -- EXPECT ERROR: 'Expected this to be never?'

-- ============================================================================
-- Section 5. Singleton + brand intersection.
--
-- Mirrors TS '& { errorBrand: never }' exactly. Same directive surfaces but
-- with an extra brand bullet, so this costs a line of noise without adding
-- protection over singleton-only.
-- ============================================================================

type _Section5Directive = "universeId is already declared on the root universe block; remove it from this environment overlay, or remove it from root and declare it on every environment overlay instead"

type _Section5Forbidden = {
	universeId: (_Section5Directive & { errorBrand: never })?,
}

local _section5_ok: _Section5Forbidden = {}
local _section5_bad: _Section5Forbidden = { universeId = "anything" } -- EXPECT ERROR: directive verbatim + brand bullet

-- Even if the user types the directive verbatim, the brand check still
-- fails -- a hedge against a confused human or agent assigning the literal.
local _section5_pedantic: _Section5Forbidden = {
	universeId = "universeId is already declared on the root universe block; remove it from this environment overlay, or remove it from root and declare it on every environment overlay instead", -- EXPECT ERROR: brand bullet still fails
}

-- ============================================================================
-- Section 6. Type-function structural guard limitation.
--
-- This section type-checks cleanly -- which IS the demonstration. The type
-- function reaches into the indexer and returns the homogeneous value type;
-- it cannot see that the argument has two env keys (production, staging) or
-- that they carry different universe overlays. A check_xor that wants to
-- detect `universeId` set on `environments.production.universe` cannot do
-- so; the per-key dimension is collapsed by the indexer.
-- ============================================================================

type function _section6_inspect_indexer(t: type): type
	if not t:is("table") then
		error("not a table")
	end
	local indexer = t:indexer()
	if indexer == nil then
		error("no indexer; per-key shapes are visible but expensive to walk")
	end
	-- indexer.readresult is the homogeneous V; no per-key access.
	return indexer.readresult
end

local _section6: _section6_inspect_indexer<{ [string]: { universe: { universeId: string? }? } }> = {
	production = { universe = { universeId = "12345" } },
	staging = { universe = {} },
}

-- ============================================================================
-- Section 7. Top-level Config union annotation -- INVALID config fan-out.
--
-- Annotating a literal against `Config = ConfigRootUniverseId | ConfigEnvironmentUniverseId`
-- causes the new solver to enumerate every property mismatch across both
-- variants. The directive is buried in a 13-bullet wall.
-- ============================================================================

local _section7: Config = { -- EXPECT ERROR: 13-bullet fan-out, directive is bullets 6 and 10
	universe = { universeId = "12345" },
	environments = {
		production = { universe = { universeId = "67890" } },
	},
}

-- ============================================================================
-- Section 8. Top-level Config union annotation -- VALID configs ALSO fan out.
--
-- The critical finding that ruled out "live with verbose diagnostics".
-- Both of these are valid configs (universeId at root only, or universeId
-- per env only). The union annotation still produces multi-bullet fan-out
-- diagnostics because the new solver does per-component exact-match
-- against each variant rather than a subtype check.
-- ============================================================================

local _section8_valid_root: Config = { -- EXPECT ERROR: 12-bullet fan-out on a VALID root-only config
	universe = { universeId = "12345" },
	environments = {
		production = { universe = { description = "Live" } },
	},
}

local _section8_valid_env: Config = { -- EXPECT ERROR: 9-bullet fan-out on a VALID env-only config
	environments = {
		production = { universe = { universeId = "12345" } },
	},
}

-- ============================================================================
-- Section 9. Variant-pinned annotation -- the clean baseline.
--
-- Pinning the annotation to one variant (here ConfigRootUniverseId) collapses
-- the diagnostic to a single focused bullet with the directive verbatim at
-- the offending field's line/column. This is the encoding ADR-025 will ship
-- when Luau ships the union-narrowing fix (luau-lang/luau#2205); today the
-- shipped permissive Config has no variants so this pattern is unreachable
-- from user code until then.
-- ============================================================================

local _section9_valid: ConfigRootUniverseId = {
	universe = { universeId = "12345" },
	environments = {
		production = { universe = { description = "Live" } },
	},
}

local _section9_invalid: ConfigRootUniverseId = {
	universe = { universeId = "12345" },
	environments = {
		production = { universe = { universeId = "67890" } }, -- EXPECT ERROR: clean 1-bullet directive
	},
}

-- ============================================================================
-- Section 10. Discriminator-field workaround (REJECTED schema-change path).
--
-- If we added a top-level singleton-string discriminator (`mode: "root" |
-- "env"`) to the schema, the new solver could narrow the union on the
-- discriminator and produce clean diagnostics through a single
-- `defineConfig(c: Config): Config` non-generic wrapper. Rejected because
-- the discriminator is a schema field added purely to work around a
-- transient Luau type-solver limitation; adding it locks every user config
-- into carrying a redundant field forever, and removing it later when
-- Luau ships the fix is a wire-contract change.
-- ============================================================================

type _Section10RootVariant = {
	mode: "root",
	universe: { universeId: string },
	environments: {
		[string]: {
			universe: {
				universeId: "universeId is already declared on the root universe block"?,
				description: string?,
			}?,
		},
	},
}

type _Section10EnvVariant = {
	mode: "env",
	universe: {
		universeId: "universeId is already declared per environment"?,
		description: string?,
	}?,
	environments: {
		[string]: {
			universe: { universeId: string, description: string? },
		},
	},
}

type _Section10Config = _Section10RootVariant | _Section10EnvVariant

local function _section10_defineConfig(c: _Section10Config): _Section10Config
	return c
end

local _section10_valid_root = _section10_defineConfig({
	mode = "root",
	universe = { universeId = "12345" },
	environments = {
		production = { universe = { description = "Live" } },
	},
})

local _section10_invalid_root = _section10_defineConfig({
	mode = "root",
	universe = { universeId = "12345" },
	environments = {
		production = { universe = { universeId = "67890" } }, -- EXPECT ERROR: clean 1-bullet directive
	},
})

local _section10_valid_env = _section10_defineConfig({
	mode = "env",
	environments = {
		production = { universe = { universeId = "12345" } },
	},
})

local _section10_invalid_env = _section10_defineConfig({
	mode = "env",
	universe = { universeId = "12345" }, -- EXPECT ERROR: clean 1-bullet directive
	environments = {
		production = { universe = { universeId = "67890" } },
	},
})

-- ============================================================================
-- Section 11. Fluent expectTypeOf().toEqualTypeOf() -- REJECTED testing API.
--
-- vitest's TypeScript surface for type assertions is `expectTypeOf<A>().
-- toEqualTypeOf<B>()`. The Luau equivalent looks syntactically right but
-- type functions inside generic function bodies are silently suppressed;
-- the assertion never fires regardless of input. The day-1 form ADR-025
-- ships is the type-level `Expect<A, B>` alias, which works correctly
-- because it lives at the alias-declaration site rather than inside a
-- generic function body.
--
-- This section uses an always-erroring type function to demonstrate the
-- contrast cleanly without depending on Luau's type-equality primitives.
-- The shipped `Expect<A, B>` in `@bedrock/testing` will use a structural
-- equality check via the typeforge-style `sort_type` normaliser.
-- ============================================================================

type function _section11_AssertFires(_a: type, _b: type): type
	error("type function fired -- proves the function runs at the call site")
end

-- Direct type-level usage: fires.
type _Section11Direct = _section11_AssertFires<string, number> -- EXPECT ERROR: type function fires

local function _section11_phantom<T>(): T
	return (nil :: any) :: T
end

local function _section11_expectTypeOf<T>(_subject: T): { toEqualTypeOf: <U>(U) -> () }
	return {
		toEqualTypeOf = function<U>(_expected: U)
			-- This type-function call is suppressed; no diagnostic fires
			-- regardless of T and U.
			local _: _section11_AssertFires<T, U>? = nil
		end,
	}
end

-- Both of these silently pass; the always-erroring type function never fires
-- from inside the generic body. This is the bug that ruled out the fluent
-- API for day-1.
_section11_expectTypeOf(_section11_phantom() :: string).toEqualTypeOf(_section11_phantom() :: string)
_section11_expectTypeOf(_section11_phantom() :: string).toEqualTypeOf(_section11_phantom() :: number)

return {}
