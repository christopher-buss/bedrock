---
---

Bump the `vite-plus` toolchain (0.1.19 → 0.2.1) and `concurrently` (9.1.0 → 10.0.3) to clear dev-only security advisories (vitest-browser RCE, shell-quote injection). The 0.2.0 release drops the bundled `@voidzero-dev/vite-plus-test` wrapper in favour of upstream Vitest (4.1.9), so `vitest` now resolves directly and the Stryker vitest-runner version-stand-in patch is no longer needed. No change to any published package's runtime behavior.
