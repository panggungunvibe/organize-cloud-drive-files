// Data adapters for the original organizer. No invented files or assignments.
export const PREVIEW_LIMIT = 180;
const colors = ['#76a7ff', '#68c7c4', '#78bc86', '#e2b567', '#ae90d8', '#df99b8'];
export function buildLeaves(items) {
  const leaves = new Map(), roots = new Map();
  for (const item of items) {
    const key = JSON.stringify(item.destination);
    if (!roots.has(item.destination[0])) roots.set(item.destination[0], colors[roots.size % colors.length]);
    if (!leaves.has(key)) leaves.set(key, { id: `leaf-${leaves.size}`, key, path: item.destination, name: item.destination.at(-1), parent: item.destination.slice(0, -1).join(' / '), color: roots.get(item.destination[0]), items: [], count: 0 });
    const leaf = leaves.get(key); leaf.items.push(item); leaf.count++;
  }
  return [...leaves.values()];
}

export function splitLeaves(leaves) {
  const photos = leaves.filter(l => l.items.every(i => i.media === 'photo'));
  const videos = leaves.filter(l => l.items.every(i => i.media === 'video'));
  const rest = leaves.filter(l => !photos.includes(l) && !videos.includes(l));
  if (photos.length && videos.length) return { left: photos, right: [...videos, ...rest], leftTitle: '照片', rightTitle: rest.length ? '视频 / 其他' : '视频' };
  const ordered = [...photos, ...videos, ...rest];
  const middle = Math.ceil(ordered.length / 2);
  const label = videos.length === leaves.length ? '视频' : photos.length === leaves.length ? '照片' : '素材';
  return { left: ordered.slice(0, middle), right: ordered.slice(middle), leftTitle: label + '分类', rightTitle: label + '分类' };
}

export function selectPreviewAssets(items, limit = PREVIEW_LIMIT) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Invalid preview limit');
  const seen = new Set(), candidates = [];
  // Real covers take priority. The fallback is a named file card, never a sample image.
  for (const item of [...items.filter(i => i.thumbnail), ...items.filter(i => !i.thumbnail)]) {
    const key = item.coverKey || item.thumbnail || item.id;
    if (!seen.has(key)) { seen.add(key); candidates.push(item); }
  }
  const chosen = [], used = new Set();
  const add = item => { if (chosen.length < limit && !used.has(item.id)) { used.add(item.id); chosen.push(item); } };
  // Preserve rare destinations so the preview is not dominated by one large folder.
  for (const leaf of buildLeaves(candidates)) add(leaf.items[0]);
  const count = Math.min(limit - chosen.length, candidates.length - chosen.length);
  const remaining = candidates.filter(i => !used.has(i.id));
  for (let i = 0; i < count; i++) add(remaining[Math.min(remaining.length - 1, Math.floor((i + .5) * remaining.length / count))]);
  return chosen;
}

// Geometry copied from the approved organizer's buildMediaGlobe.
export function globePlacement(index, count) {
  const angle = index * Math.PI * (3 - Math.sqrt(5));
  const radius = Math.sqrt((index + .3) / count) * 46;
  return { x: 50 + Math.cos(angle) * radius, y: 50 + Math.sin(angle) * radius * .94, rotation: ((index * 29) % 42) - 21, size: 16 + (index % 5) * 1.6, z: 100 + Math.round(48 - radius) };
}
