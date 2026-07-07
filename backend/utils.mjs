export function slugify(value) {
  return String(value || 'element')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'element';
}

export function pyString(value) {
  return JSON.stringify(String(value || ''));
}
