# Change intent terminology

- **Change intent**: A package-local release decision containing a bump or an
  explicit decline, with a summary for the changelog when a release is requested.
- **Versioned consumer**: A workspace package that participates in native pnpm
  versioning and directly consumes a changed dependency.
- **Review reason**: An unexplained or ambiguous change whose release impact
  requires a human decision.
- **Human coverage**: An explicit release decision recorded by the PR author
  for named packages, taking priority over an automatic decision for those packages.
