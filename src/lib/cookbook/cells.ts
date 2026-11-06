// The cell rule every runner shares (ADR-0130): cells run in order, and a run
// stops at the first cell that goes other than its recipe says. The checker
// uses it now; the page runtime will too. Tested with cells.cases.json.

/** A cell's last wire envelope (parsed), or null when it ran no statement. */
export type LastEnvelope = { error?: string | null } | null;

/** Whether a cell failed. A script stops at its first error, so that is its last envelope's. */
export const failed = (last: LastEnvelope): boolean => (last?.error ?? null) !== null;

/**
 * How a cell's run differs from what its recipe says, or null: an error
 * where none is expected, or success where the cell is `expectError`.
 */
export function surprise(cell: { id: string; expectError: boolean }, last: LastEnvelope): string | null {
  if (!cell.expectError && failed(last)) return `cell \`${cell.id}\` failed: ${last!.error}`;
  if (cell.expectError && !failed(last)) return `cell \`${cell.id}\` is marked expect=error but succeeded`;
  return null;
}
