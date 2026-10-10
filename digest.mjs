// Monitor digest: one short file listing every scanner change in the last HOURS.
import fs from 'node:fs';
import { parseCSV, toDate, stamp, closureLine, summarizeComment } from './lib.mjs';

const O = 'scoopdisney';
const HOURS = Number(process.env.HOURS || 24);
const CAP = 40;
const now = new Date(), since = new Date(now - HOURS * 3600e3);
const T = process.env.GITHUB_TOKEN;
const H = { 'User-Agent': 'monitor-digest', Accept: 'application/vnd.github+json',
  ...(T ? { Authorization: `Bearer ${T}` } : {}) };
const raw = async (r, p) => {
  const x = await fetch(`https://raw.githubusercontent.com/${O}/${r}/main/${p}`);
  if (!x.ok) throw new Error(`${r}/${p} HTTP ${x.status}`); return x.text();
};
const api = async p => {
  const x = await fetch(`https://api.github.com${p}`, { headers: H });
  if (!x.ok) throw new Error(`${p} HTTP ${x.status}`); return x.json();
};
const inWin = d => toDate(d) >= since;
const errors = [];
const cap = (lines, what) => lines.length > CAP
  ? [...lines.slice(0, CAP), `- ...and ${lines.length - CAP} more ${what} (see the repo file)`] : lines;
async function safe(name, fn) { try { return await fn(); } catch (e) { errors.push(`${name}: ${e.message}`); return []; } }

const closures = await safe('closures', async () =>
  parseCSV(await raw('closure-watch', 'data/closure-log.csv'))
    .filter(r => r.detected >= since.toISOString().slice(0, 10)).map(closureLine));

const permits = await safe('permits', async () => {
  const out = [];
  for (const [r, tag] of [['dlr-permit-watch', 'DLR'], ['wdw-permit-watch', 'WDW']])
    for (const p of parseCSV(await raw(r, 'data/scan/log.csv')).filter(p => inWin(p.detected_at))) {
      const rev = /-REV\d+/i.test(p.number) ? ' (revision)' : '';
      const st = p.kind === 'STATUS' ? `${p.from} -> ${p.to}` : p.to;
      out.push(`- [${stamp(toDate(p.detected_at))}] ${tag} ${p.kind}${rev} ${p.number} [${st}]: ${p.title}${/CapHome/.test(p.link) ? '' : ' ' + p.link}`);
    }
  return out.sort().reverse();
});

const prices = await safe('prices', async () => {
  const out = [];
  for (const [r, tag] of [['disney-menu-watch', 'DLR'], ['wdw-menu-watch', 'WDW']]) {
    const g = {};
    for (const x of parseCSV(await raw(r, 'data/price-changes.csv')).filter(x => inWin(x.Detected))) {
      const k = `${x.Restaurant} (${x.Park})`; const pc = parseFloat(x.Percent);
      const e = g[k] ||= { n: 0, up: 0, down: 0, lo: Infinity, hi: -Infinity, last: x.Detected };
      e.n++; pc >= 0 ? e.up++ : e.down++; e.lo = Math.min(e.lo, pc); e.hi = Math.max(e.hi, pc);
      if (x.Detected > e.last) e.last = x.Detected;
    }
    for (const [k, e] of Object.entries(g))
      out.push(`- [${e.last}Z] ${tag} ${k}: ${e.n} changes (${e.up} up, ${e.down} down), ${e.lo}% to ${e.hi}%`);
  }
  return out.sort().reverse();
});

const MENUS = [['disney-menu-watch', 'DLR', true], ['wdw-menu-watch', 'WDW', true],
  ['paris-menu-watch', 'Paris', false], ['shanghai-menu-watch', 'Shanghai', false]];
const dailies = await safe('daily reports', async () => {
  const out = [];
  for (const [r, tag, hasCsv] of MENUS) {
    const issues = await api(`/repos/${O}/${r}/issues?state=open&per_page=5`);
    for (const i of issues) {
      const cs = await api(`/repos/${O}/${r}/issues/${i.number}/comments?since=${since.toISOString()}&per_page=50`);
      for (const c of cs) {
        const parts = summarizeComment(c.body || '', hasCsv);
        if (parts.length) out.push(`- [${stamp(new Date(c.created_at))}] ${tag}: ${parts.join('; ')}`);
      }
    }
  }
  return out.sort().reverse();
});

const REPOS = { 'closure-watch': 8, 'dlr-permit-watch': 8, 'wdw-permit-watch': 8,
  'disney-menu-watch': 8, 'wdw-menu-watch': 8, 'paris-menu-watch': 26, 'shanghai-menu-watch': 26 };
const health = [];
for (const [r, lim] of Object.entries(REPOS)) {
  try {
    const [c] = await api(`/repos/${O}/${r}/commits?per_page=1`);
    const age = (now - new Date(c.commit.committer.date)) / 3600e3;
    health.push(`- ${r}: last run ${age.toFixed(1)}h ago ${age > lim ? `STALE (limit ${lim}h)` : 'OK'}`);
  } catch (e) { health.push(`- ${r}: could not check (${e.message})`); }
}

const sec = (t, l, what) => [`## ${t} (${l.length})`, ...(l.length ? cap(l, what) : ['- none']), ''];
const md = [
  `# Scoop monitor digest`,
  `Generated ${stamp(now)}. Covers ${stamp(since)} to now (${HOURS}h). Every line starts with its UTC time; read only lines inside your window.`, '',
  ...sec('Closures', closures, 'closure rows'),
  ...sec('Permits', permits, 'permit rows'),
  ...sec('Menu prices by venue', prices, 'venues'),
  ...sec('Menu daily reports (new/gone items, venue changes)', dailies, 'reports'),
  '## Monitor health', ...health, '',
  ...(errors.length ? ['## Digest errors', ...errors.map(e => `- ${e}`), ''] : [])
].join('\n');
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/digest.md', md);
console.log(md);
