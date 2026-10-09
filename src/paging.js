// Server-side pagination: the browser sends ?page=2&size=10 and gets back only that page.
export function pageParams(query) {
  const size = Math.min(100, Math.max(1, parseInt(query.size) || 10));
  const page = Math.max(1, parseInt(query.page) || 1);
  return { page, size, offset: (page - 1) * size };
}

export const pageResult = (items, total, { page, size }) => ({
  items, total, page, size, pages: Math.max(1, Math.ceil(total / size)),
});

// Makes a safe LIKE pattern from what the user typed (so % and _ are not treated as wildcards).
export const likeTerm = (text) => '%' + String(text || '').trim().replace(/[\\%_]/g, '\\$&') + '%';

// If someone asks for page 9 but only 3 pages exist, fall back to the last page.
export function clampPage(pg, total) {
  const pages = Math.max(1, Math.ceil(total / pg.size));
  const page = Math.min(pg.page, pages);
  return { ...pg, page, offset: (page - 1) * pg.size };
}
