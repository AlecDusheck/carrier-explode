# carrier-explode

iOS and Android carrier settings, decoded and compared. A pnpm workspace:

- `apps/site`: the SvelteKit Worker.
- `apps/extractor`: the ingest Worker, its Workflows and its containers.
- `packages/*`: shared logic.

Headers in `packages/*/src` describe each package; `scripts/check-deps.ts` enforces the package rules.

## Code

- Idiomatic, strict TypeScript: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
- No `any`. No `as` except at a validated boundary. No `!`.
- Validate external input (`unknown` + valibot or narrowing) once, at the boundary.
- Model states as discriminated unions, not optional-field soup. Make public types `readonly`. Check tables with `satisfies`.
- Give every export an explicit return type. Use `import type` for type-only imports.
- Derive types from one source; never restate a shape. Use `typeof`, `(typeof X)[number]`, `ReturnType`, `Parameters`, `Awaited`, indexed access, mapped and template-literal types, and `v.InferOutput` for valibot schemas. A union of literals comes from a `const` array.
- Small modules, pure functions by default. A class only when state truly belongs together.
- Do it right the first time:
  - no shims or compatibility code for data that doesn't exist;
  - no fields that are optional just in case;
  - no platform special-cased inside another platform's code;
  - no "for now".
- Never swallow errors.
- Leave no dead code, commented-out code or stray logging.

## Packages

- One home per piece of logic. Import other packages only through their entry point.
- The iOS and Android decoders never import each other. Neither does `firmware`.
- `schema` is the only package that sees both decoders.
- Only `schema` derives timelines, carriers and indexes. Apps read the results; they never recompute them.

## Comments and docs

- Concise. A comment says *why*, in a line or two. It never says *what* the code already says.
- **If code or a type needs a paragraph to explain, it is wrong: redesign it.**
- Evidence, measurements and history go in commit messages, not in code.
- No section-divider banners. Keep names precise enough that most comments are unnecessary.

## Claims

- Never claim two things are identical, unchanged or equivalent without having compared them.
- State the evidence (what was compared, how) in the commit or report.
