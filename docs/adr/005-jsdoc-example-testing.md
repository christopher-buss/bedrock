# ADR-005: Tested JSDoc Examples

Date: 2025-12-13 Status: Accepted

Decision Makers: Maintainer Tags: documentation, testing, jsdoc

## Context

Bedrock generates documentation from TSDoc comments (ADR-004). JSDoc `@example`
blocks demonstrate API usage but can become stale when implementations change.
Publishing documentation with broken examples undermines user trust and causes
frustration. Good intentions aren't enough - without tooling, regressions are
inevitable.

## Decision

Use **generate-jsdoc-example-tests** to generate executable tests from
`@example` comments, combined with **typedoc-plugin-replace-text** to strip test
assertions from published documentation.

This ensures:

1. CI fails if any `@example` is incorrect
2. Published docs show clean usage examples (no `expect()` calls)

### Scope

- **Required:** Public API functions used in documentation generation
- **Encouraged:** Any function with an `@example` tag

## Consequences

### Positive

- Documentation cannot be published with broken examples
- Single source of truth (examples are both docs and tests)
- Explicit imports in examples help users know where to import from
- Aligns with TDD culture (ADR-003)

### Negative

- Verbose examples (explicit imports required in every `@example`)
- Two-tool workflow (gen-jet for tests, TypeDoc replace-text for clean output)
- Contributors must learn the `@example` format requirements

## Alternatives Considered

### Separate examples and tests

Maintain `@example` blocks for documentation and separate unit tests for
verification.

**Rejected because:** Examples and tests inevitably drift. Without automated
enforcement, regressions will occur regardless of good intentions.

### Manual review of examples

Trust code review to catch stale examples.

**Rejected because:** Manual processes don't scale and are error-prone. Tooling
provides consistent enforcement.

### No example testing

Accept that some examples may be incorrect.

**Rejected because:** Broken documentation erodes user trust and contradicts the
project's quality standards.

## Implementation Notes

### Example Format

Examples must use fenced code blocks. Import the module being demonstrated; the
`expect` function is provided by the test generator's header:

````typescript
/**
 * @example
 *
 * ```ts
 * import { myFunction } from "./module";
 *
 * const result = myFunction();
 * expect(result).toBe(expected);
 * ```
 */
````

### TypeDoc Configuration

The `typedoc-plugin-replace-text` strips vitest imports and assertions:

```json
{
	"replaceText": {
		"replacements": [
			{
				"pattern": ".*import.*from [\"']vitest[\"'].*\\n",
				"replace": ""
			},
			{ "pattern": ".*expect\\(.*\\n", "replace": "" }
		]
	}
}
```

## Related Decisions

- ADR-003: Testing Strategy (TDD mandatory, 100% coverage)
- ADR-004: Documentation Site (TSDoc generates documentation)

## References

- [generate-jsdoc-example-tests](https://github.com/SacDeNoeuds/generate-jsdoc-example-tests)
- [typedoc-plugin-replace-text](https://github.com/krisztianb/typedoc-plugin-replace-text)
