// Small helpers for the monitor digest.
export function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { f += '"'; i++; }
      else if (c === '"') q = false; else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const head = rows.shift() || [];
  return rows.filter(r => r.length > 1).map(r =>
    Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

// "2026-10-09 23:49" or "2026-10-09" or ISO -> Date (UTC)
export function toDate(s) {
  if (!s) return new Date(NaN);
  if (/^\d{4}-\d\d-\d\d$/.test(s)) return new Date(s + 'T00:00:00Z');
  if (/^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(s)) return new Date(s.replace(' ', 'T') + ':00Z');
  return new Date(s);
}

export const stamp = d => d.toISOString().slice(0, 16).replace('T', ' ') + 'Z';

const dayAfter = d => new Date(toDate(d).getTime() + 86400000).toISOString().slice(0, 10);

export function closureLine(r) {
  const wasEnd = (r.was || '').split('..')[1];
  const gap = wasEnd ? (toDate(wasEnd) - toDate(r.end)) / 86400000 : 0;
  const reopen = r.kind === 'REOPENING DATE SET' || (r.kind === 'SHORTENED' && gap >= 14);
  const tag = reopen ? `REOPENING DATE: reopens ${dayAfter(r.end)} — ` : '';
  return `- [${r.detected}] ${r.resort} ${tag}${r.kind}: ${r.name} (${r.park}) ${r.type} ` +
    `${r.start}..${r.end}${r.was ? ` (was ${r.was})` : ''}`;
}

// Group daily-log comment bullets by section and venue.
export function summarizeComment(body, skipPrices) {
  const out = {}; let sec = null;
  for (const line of body.split('\n')) {
    const h = line.match(/^#{2,4}\s+(.*)/);
    if (h) {
      const t = h[1].toLowerCase();
      sec = /new item/.test(t) ? 'new' : /gone|removed/.test(t) ? 'gone'
        : /price change/.test(t) ? 'price' : /venue/.test(t) ? 'venue' : null;
      continue;
    }
    if (!sec || (sec === 'price' && skipPrices)) continue;
    const more = line.match(/and (\d+) more/);
    if (more) { (out._more ||= {})[sec] = (out._more[sec] || 0) + +more[1]; continue; }
    const b = line.match(/^- \*\*(.+?)\*\*/) || (sec === 'venue' && line.match(/^- ([^:]+):\s*(.*)/));
    if (!b) continue;
    const v = b[1].trim();
    out[v] ||= { new: 0, gone: 0, price: 0, venue: '' };
    if (sec === 'venue') out[v].venue = (b[2] || '').trim(); else out[v][sec]++;
  }
  const more = out._more; delete out._more;
  const parts = Object.entries(out).map(([v, c]) => {
    const bits = [];
    if (c.new) bits.push(`+${c.new} new`);
    if (c.gone) bits.push(`-${c.gone} gone`);
    if (c.price) bits.push(`${c.price} price changes`);
    if (c.venue) bits.push(`items ${c.venue}`);
    const flag = c.new >= 5 && c.gone >= 5 ? ' LIKELY NEW MENU' : '';
    return `${v}: ${bits.join(', ')}${flag}`;
  });
  if (more) parts.push(`unlisted: ${Object.entries(more).map(([k, n]) => `${n} more ${k}`).join(', ')}`);
  return parts;
}
