/**
 * CLI argument parsing, extracted from cli.ts so it can be tested — cli.ts runs `main()` on
 * import, so it cannot be imported into a test without launching the program.
 *
 * The one rule with teeth here is which flags consume the token after them. H8 (2026-07-24):
 * the original parser dropped ANY positional whose predecessor started with `--`, so a boolean
 * flag swallowed the next argument. `reply --quick d_target` lost `d_target` and published the
 * latest pending draft instead of the one named — the worst failure a human-approval tool can
 * have. Only value-taking flags may consume a value.
 */

/**
 * Flags that take a value, so the following token is theirs and is NOT a positional.
 * Derived from the flags read with a value (flagValue) rather than as a boolean (flags.has).
 * Keep this in step when a value-flag is added to the CLI.
 */
export const VALUE_FLAGS = new Set(['checkpoint', 'commit', 'every', 'kind', 'limit', 'sub']);

/**
 * The positional arguments in `rest` (everything after the command word), with each
 * value-flag's value removed. A boolean flag consumes nothing. `--flag=value` form consumes
 * nothing either — the value is attached, not a separate token.
 */
export function positionalArgs(rest: readonly string[], valueFlags: ReadonlySet<string> = VALUE_FLAGS): string[] {
  const consumed = new Set<number>();
  rest.forEach((tok, i) => {
    if (!tok.startsWith('--') || tok.includes('=')) return;
    const next = rest[i + 1];
    if (valueFlags.has(tok.slice(2)) && next !== undefined && !next.startsWith('--')) {
      consumed.add(i + 1);
    }
  });
  return rest.filter((a, i) => !a.startsWith('--') && !consumed.has(i));
}
