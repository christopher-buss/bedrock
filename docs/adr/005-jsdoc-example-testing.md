# ADR-005: JSDoc Example Testing with generate-jsdoc-example-tests

Date: 2025-12-12 Status: Accepted

Decision Makers: Maintainer Tags: testing, documentation, jsdoc, quality

## Context

Bedrock is an Infrastructure-as-Code tool requiring high documentation quality.
JSDoc `@example` comments demonstrate API usage, but can become stale when
implementations change without corresponding example updates.

Problems with traditional examples:

- Examples drift from actual behavior (silent failures)
- Manual synchronization between docs and tests (duplication)
- No verification that examples actually work
- Contradicts TDD culture (untested code paths)

Requirements:

- Documentation must be accurate (single source of truth)
- Examples should be executable (living documentation)
- TDD mandatory (100% coverage includes examples)
- Align with Vitest testing infrastructure (ADR-003)

## Decision

Use **generate-jsdoc-example-tests** to generate executable tests from JSDoc
`@example` comments.

### Configuration

```json
{
	"testFunctionName": "it",
	"testFileExtension": ".example.spec",
	"headers": ["import { describe, expect, it } from \"vitest\";"]
}
```

### Generated File Strategy

- Generated `*.example.spec.ts` files are **gitignored**
- Regenerated on demand (pre-test hook or manually)
- Source of truth: `@example` comments in source files
- Coverage includes generated tests (examples count toward 100%)

### Example Format Requirements

`@example` comments must follow strict format:

#### 1. Fenced Code Blocks

Use triple backticks with `ts` language identifier:

````typescript
/**
 * @example Simple assertion
 *
 * ```ts
 * import { expect } from "vitest";
 * import { myFunction } from "./module";
 *
 * const result = myFunction();
 * expect(result).toBe(true);
 * ```
 */
````

#### 2. Explicit Imports

**Required**: All dependencies must be imported explicitly.

````typescript
/**
 * @example
 *
 * ```ts
 * import { expect } from "vitest"; // ✓ Required
 * import { myFunction } from "./module"; // ✓ Required
 *
 * expect(myFunction()).toBe(true);
 * ```
 */
````

**Invalid**: Implicit dependencies fail:

````typescript
/**
 * @example
 *
 * ```ts
 * // ✗ Missing imports - test will fail
 * expect(myFunction()).toBe(true);
 * ```
 */
````

#### 3. Assertion Keywords

Examples must contain testable assertions using `expect()`:

````typescript
/**
 * @example Validation
 *
 * ```ts
 * import { expect } from "vitest";
 * import { validateConfig } from "./config";
 *
 * const config = { experience: "test" };
 * expect(validateConfig(config)).toBe(true);
 * ```
 */
````

#### 4. Example Titles

Title becomes test name (shown in test output):

````typescript
/**
 * @example Returns true for valid config
 *
 * ```ts
 * // ... becomes: it("Returns true for valid config")
 * ```
 *
 * @example Throws for missing experience
 *
 * ```ts
 * // ... becomes: it("Throws for missing experience")
 * ```
 */
````

#### 5. Skipping Examples

Use `@skipTest` to exclude non-executable examples (pseudocode, partial
snippets):

````typescript
/**
 * @example Conceptual usage (not executable)
 *
 * @skipTest
 * ```ts
 * // This won't generate a test
 * const result = hypotheticalAPI();
 * ```
 */
````

### Best Practices

#### Keep Examples Small and Focused

**Good**: One concept per example

````typescript
/**
 * @example Returns deployed state
 *
 * ```ts
 * import { expect } from "vitest";
 * import { deploy } from "./deploy";
 *
 * const result = deploy({ experience: "test" });
 * expect(result.status).toBe("deployed");
 * ```
 */
````

**Bad**: Testing multiple unrelated behaviors

````typescript
/**
 * @example Does everything
 *
 * ```ts
 * // Tests deploy, rollback, state management, and error handling
 * // ... 50 lines of mixed concerns
 * ```
 */
````

#### One Assertion Per Example (Preferred)

Makes failures easier to diagnose:

````typescript
/**
 * @example Returns correct status
 *
 * ```ts
 * import { expect } from "vitest";
 * import { deploy } from "./deploy";
 *
 * const result = deploy({ experience: "test" });
 * expect(result.status).toBe("deployed");
 * ```
 *
 * @example Includes deployment timestamp
 *
 * ```ts
 * import { expect } from "vitest";
 * import { deploy } from "./deploy";
 *
 * const result = deploy({ experience: "test" });
 * expect(result.timestamp).toBeDefined();
 * ```
 */
````

#### Use Descriptive Names

Example titles should describe expected behavior (like test names):

```typescript
/**
 * @example Validates experience ID format
 *
 * @example Throws InvalidExperienceError for missing ID
 *
 * @example Accepts numeric experience IDs
 */
```

#### Always Import Dependencies Explicitly

Even for common utilities:

````typescript
/**
 * @example
 *
 * ```ts
 * import { expect } from "vitest"; // ✓ Always
 * import { BedrockConfig } from "./types"; // ✓ Always
 * import { createConfig } from "./config"; // ✓ Always
 *
 * const config: BedrockConfig = createConfig();
 * expect(config).toBeDefined();
 * ```
 */
````

### Workflow Integration

#### Development Workflow

```bash
# 1. Write function with @example
# 2. Generate tests from examples
pnpm gen:example-tests

# 3. Run tests (includes generated example tests)
pnpm test

# 4. Coverage includes examples
pnpm test --coverage
```

#### CI Workflow

```bash
# Regenerate examples before test run
pnpm gen:example-tests && pnpm test --coverage
```

#### Pre-commit Hook (Optional)

```bash
# Regenerate examples to catch stale docs
pnpm gen:example-tests
```

## Consequences

### Positive

- Documentation stays accurate (examples are tested)
- Single source of truth (no duplication)
- Examples count toward 100% coverage
- Living documentation (examples prove API works)
- TDD enforced for examples (write example, see it fail, implement)
- Aligns with existing Vitest infrastructure
- Generated tests follow project conventions (`it()`, `*.spec.ts`)

### Negative

- Verbose (manual imports required for each example)
- Must remember fenced code block format (triple backticks + `ts`)
- Generated files must be regenerated (not self-updating)
- Examples must be executable (limits pseudocode flexibility)
- Adds build step dependency

### Neutral

- Examples become test specifications (shift in thinking)
- Generated files gitignored (reduces diff noise)
- `@skipTest` available for non-executable examples

## Alternatives Considered

### Manual Test Duplication

Write examples and tests separately.

**Pros**: Full control, traditional approach, no tooling dependency.

**Rejected**: Violates DRY principle. Examples and tests drift independently.
Maintenance burden doubles. Contradicts "single source of truth" philosophy.

### No Example Validation

Trust developers to keep examples accurate.

**Pros**: Simpler, no tooling, no format constraints.

**Rejected**: Examples inevitably become stale. Contradicts TDD culture.
Documentation becomes unreliable. Users copy broken examples.

### doctest-ts

Alternative JSDoc testing tool.

**Pros**: Mature, similar concept.

**Rejected**: Less flexible configuration. Doesn't integrate as cleanly with
Vitest. generate-jsdoc-example-tests allows custom test function names and file
extensions matching project conventions.

### Custom Solution

Build internal tooling to extract and test examples.

**Pros**: Complete control, tailored to exact needs.

**Rejected**: Maintenance burden. generate-jsdoc-example-tests already solves
this. Not core to Bedrock's value proposition. Reinventing wheel.

### Documentation-Only Examples

Keep examples as non-executable documentation.

**Pros**: No format constraints, pseudocode allowed.

**Rejected**: Examples can't be trusted (no verification). Contradicts 100%
coverage requirement. Users can't verify examples work.

## Implementation Notes

### Gitignore Pattern

Add to `.gitignore`:

```gitignore
# Generated JSDoc example tests
**/*.example.spec.ts
```

### Package Scripts

```json
{
	"scripts": {
		"gen:example-tests": "bun scripts/generate-example-tests.ts",
		"test": "vitest"
	}
}
```

The script uses the programmatic API via `scripts/generate-example-tests.ts`
which dynamically discovers all `{packages,apps}/*/src` directories.

### Coverage Configuration

Generated example tests automatically included in coverage:

```typescript
// vitest.config.ts
export default defineConfig({
	test: {
		coverage: {
			exclude: [
				"**/*.spec.ts", // Regular tests
				"**/*.example.spec.ts", // Generated example tests (excluded)
			],
			thresholds: {
				branches: 100,
				functions: 100,
				lines: 100,
				statements: 100,
			},
		},
	},
});
```

**Note**: Generated tests are excluded from coverage calculation, but **source
code** exercised by examples counts toward coverage.

### Example Template

Copy-paste template for new functions:

<!-- eslint-skip -->

````text
/**
 * Brief description of function.
 *
 * @example Descriptive title
 * ```ts
 * import { expect } from "vitest";
 * import { functionName } from "./module";
 *
 * const result = functionName();
 * expect(result).toBe(expected);
 * ```
 *
 * @param param - Parameter description.
 * @returns Return value description.
 */
export function functionName(param: string): boolean {
    // implementation
}
````

## Related Decisions

- ADR-003: Testing Strategy (TDD mandatory, 100% coverage)
- ADR-002: FCIS Architecture (core functions benefit from executable examples)

## References

- [generate-jsdoc-example-tests](https://github.com/SacDeNoeuds/generate-jsdoc-example-tests)
- [JSDoc @example Tag](https://jsdoc.app/tags-example)
- [Vitest Documentation](https://vitest.dev/)
- [Living Documentation](https://www.goodreads.com/book/show/34927405-living-documentation)
  by Cyrille Martraire
