# Testing Strategy Notes

**Status:** Needs ADR - discuss and formalize

## Context from Architecture Discussion

- Primary goal: **Every layer should be testable** (unit, integration, e2e)
- Architecture: Ports & adapters pattern chosen for testability
- Monorepo: `packages/open-cloud`, `packages/cli`, `apps/website`

## Testing Levels to Define

### Unit Tests
- Core business logic (pure functions)
- Individual adapters (mocked dependencies)
- Open Cloud client (mocked HTTP)

### Integration Tests
- Core + real adapters (e.g., real Gist backend against test gist)
- CLI commands with mocked Open Cloud responses
- Config loading with real c12

### E2E Tests
- Full CLI flow against real Roblox (test universe?)
- Or: against recorded/mocked API responses?

## Open Questions

1. **Tooling**: vitest for all? Or different tools for e2e?
2. **Mocking strategy**: MSW for HTTP mocking? Or custom mocks?
3. **Test data**: Fixtures? Factories? Snapshots?
4. **CI integration**: Run all tests? Skip e2e on PR?
5. **Coverage requirements**: Minimum thresholds?
6. **Test Roblox environment**: Do we need a test universe/experience?

## Related

- ADR-001: TypeScript with Bun Runtime
- (Pending) ADR: Project Structure & Monorepo
