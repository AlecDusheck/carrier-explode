# Migrations

- **Never write, create or edit a schema migration yourself.** Change `src/schema.ts` and run `pnpm generate` (`drizzle-kit generate`); commit what it writes, untouched.
- The only migration you author is a data fill: create it with `drizzle-kit generate --custom --name <name>`, and put only `INSERT`/`UPDATE`/`DELETE` in it.
- If generated SQL can't run on existing rows (say, a `NOT NULL` column with no default), change the schema in steps drizzle can generate, with a custom data fill between them if needed. Never patch the generated file.
- `drizzle-kit check` must pass and `drizzle-kit generate` must find nothing to do.
- Never edit `d1_migrations` or apply SQL to D1 outside `pnpm migrate`. Migrations are applied by hand, never by a Worker.
