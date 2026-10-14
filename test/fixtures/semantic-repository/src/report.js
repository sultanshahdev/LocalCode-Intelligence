export function renderAnnualReport(rows) {
  return rows.map((row) => row.join(',')).join('\n');
}
