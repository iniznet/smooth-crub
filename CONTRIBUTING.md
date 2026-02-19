# Contributing to smooth-scrub

Thanks for your interest in contributing.

This project is in an early beta stage, so iteration is fast and behavior may change frequently.

## Code of Conduct

- Be respectful and constructive.
- Assume positive intent.
- Keep discussions focused on improving the project.

## Before You Start

- Use Node.js 18 or newer.
- Install dependencies:

```bash
npm install
```

## Development Workflow

1. Create a branch from `main`.
2. Make focused changes with clear commit messages.
3. Run local checks before opening a PR:

```bash
npm run format:check
npm run lint
npm run test
npm run build
```

You can also run:

```bash
npm run check
```

## Pull Request Guidelines

- Keep PRs small and focused.
- Explain the problem and your solution clearly.
- Add or update tests when behavior changes.
- Update README/docs when public behavior or API changes.
- If snapshots changed intentionally, mention why.

## Reporting Issues

When opening an issue, include:

- Environment details (Node version, OS).
- Reproduction steps.
- Expected vs actual behavior.
- Minimal ASCII sample when relevant.

## Testing Notes

- Main tests run with Vitest.
- Snapshot updates should be intentional:

```bash
npm run test:update
```

## Release Expectations (Beta)

- Versioning follows beta/pre-1.0 semantics.
- Minor changes may include breaking changes while APIs settle.
- Production consumers should pin exact versions.

## Questions

If anything is unclear, open an issue and ask.
