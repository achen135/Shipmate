/** PostgREST returns at most 1000 rows per request (Supabase default). */
export const PAGE_SIZE = 1000;

/**
 * Read every row of a query a page at a time. The query should be ordered by
 * a unique column so pages don't overlap.
 */
export async function selectAll<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  label: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}
