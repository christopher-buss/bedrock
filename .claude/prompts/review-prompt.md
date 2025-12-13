## 1. Architecture (FCIS Pattern)

- **Core**: Pure functions only, no I/O, no side effects
- **Shell**: Orchestration only, delegates to Core and Adapters
- **Ports**: Interfaces defining adapter contracts
- **Adapters**: Concrete implementations (HTTP, Gist, etc.)

Flag violations: I/O in Core, business logic in Shell/Adapters.

## 2. Testing (TDD Required)

- Every implementation MUST have corresponding tests
- Tests should have come FIRST (RED-GREEN-REFACTOR)
- 100% coverage required (statements, branches, functions, lines)
- Test naming: `it("should <behavior>")` format

**Reject if:**

- Implementation without tests
- Testing mock behavior instead of real behavior
- Mocking without understanding dependencies

## 3. Test Isolation

| Layer    | Test with         | Isolation     |
| -------- | ----------------- | ------------- |
| Core     | Unit tests        | None needed   |
| Shell    | Integration tests | Fake adapters |
| Adapters | Adapter tests     | nock for HTTP |

## 4. Security & Constraints

- **Open Cloud only**: No ROBLOSECURITY or legacy Roblox APIs
- **No secrets in state**: State files = resource IDs only (public data)
- Validate all external input at adapter boundaries

## 5. Code Quality

- TypeScript strict mode compliance
- Proper error handling with typed errors
- No any types without justification
