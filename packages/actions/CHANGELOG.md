# @bedrock-rbx/actions

## 0.1.3

### Patch Changes

- Add an `allow-spend` input to the deploy action. When it is `true`, the action passes `--allow-spend` to `bedrock deploy`, so badge creates past the free daily quota are paid for up to the environment's `spendLimit`. It defaults to `false`, so a copied workflow never spends Robux.

- Update dependencies:
  - tsdown: 0.23.4 → 0.23.7

- Stop the deploy action from running an unrelated npm package when the Bedrock CLI is not installed, and pass every input to the deploy step through the environment.

## 0.1.2

### Patch Changes

- Rebuild the bundled action against `undici` 6.29.1, clearing the undici advisories flagged in the previously bundled 6.27.0.

- Rebuild the bundled action with tsdown 0.23.1. Behaviour is unchanged.
