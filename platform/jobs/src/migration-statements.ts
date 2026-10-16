/** Splits a reviewed migration into statements for the local migrate command.
 * Whole-line `--` comments are dropped first: their prose may contain `;`
 * (015's header does), which a plain split turns into invalid SQL. */
export function migrationStatements(sql: string): string[] {
  return sql.replace(/^[ \t]*--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean);
}
