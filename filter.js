const CMP = {
  '>': (a, b) => a > b, '>=': (a, b) => a >= b,
  '<': (a, b) => a < b, '<=': (a, b) => a <= b,
  '=': (a, b) => a === b, '!=': (a, b) => a !== b,
};

export function apply(rows, q) {
  const kept = rows.filter(r =>
    q.filters.every(f => {
      const v = r[f.field];
      return typeof v === 'number' && CMP[f.op](v, f.value);
    }));
  const { field, dir } = q.sort;
  kept.sort((a, b) => {
    const x = a[field], y = b[field];
    // Baris tanpa nilai untuk kolom sort selalu di bawah, apapun arahnya.
    if (typeof x !== 'number') return typeof y === 'number' ? 1 : 0;
    if (typeof y !== 'number') return -1;
    return dir === 'asc' ? x - y : y - x;
  });
  return kept.slice(0, q.limit);
}
