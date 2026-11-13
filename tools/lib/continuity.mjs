export function attachContinuity(
  cands,
  currentPrompts,
  prevPrompts,
  { log = () => {}, prevVer = 'previous' } = {}
) {
  if (!cands.length || !prevPrompts.length) return;

  const body = p =>
    (p.pieces || []).filter(x => typeof x === 'string').join('') ||
    p.content ||
    '';
  const CAP = 20000;

  const shingles = s => {
    const t = s
      .slice(0, CAP)
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 4000);
    const out = new Set();
    const n = Math.max(0, t.length - 4);
    const sample = n >= 512;
    for (let i = 0; i + 5 <= t.length; i++) {
      let h = 5381;
      const w =
        t[i] +
        ' ' +
        t[i + 1] +
        ' ' +
        t[i + 2] +
        ' ' +
        t[i + 3] +
        ' ' +
        t[i + 4];
      for (let j = 0; j < w.length; j++)
        h = (Math.imul(h, 33) ^ w.charCodeAt(j)) | 0;
      if (!sample || (h & 7) === 0) out.add(h);
    }
    return out;
  };

  const live = new Set(currentPrompts.filter(p => p.id).map(p => p.id));
  const normBody = s =>
    s
      .replace(/\$\{[^}]*\}/g, '${}')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  const collapse = s => normBody(s.replace(/(\$\{[^}]*\})+/g, '${}'));
  const exact = new Map();
  const exactCollapsed = new Map();
  const prev = [];
  const weak = [];
  for (const p of prevPrompts) {
    if (!p.id || live.has(p.id)) continue;
    const nb = normBody(body(p));
    if (nb) {
      if (exact.has(nb)) {
        if (exact.get(nb) !== p.id) exact.set(nb, null);
      } else exact.set(nb, p.id);
    }
    const cb = collapse(body(p));
    if (cb) {
      if (exactCollapsed.has(cb)) {
        if (exactCollapsed.get(cb) !== p.id) exactCollapsed.set(cb, null);
      } else exactCollapsed.set(cb, p.id);
    }
    weak.push({ id: p.id, g: shingles(cb) });
    const g = shingles(body(p));
    if (!g.size) continue;
    prev.push({ id: p.id, g });
  }
  for (const c of cands) {
    const id =
      exact.get(normBody(c.body)) || exactCollapsed.get(collapse(c.body));
    if (id) c.reusedFrom = { id, similarity: 1 };
  }
  const index = new Map();
  prev.forEach((e, i) => {
    for (const g of e.g) {
      let a = index.get(g);
      if (!a) index.set(g, (a = []));
      a.push(i);
    }
  });

  for (const c of cands) {
    if (c.reusedFrom) continue;
    const cg = shingles(c.body);
    if (!cg.size) continue;
    const score = new Map();
    for (const g of cg) {
      const a = index.get(g);
      if (a) for (const i of a) score.set(i, (score.get(i) || 0) + 1);
    }
    let bestI = -1,
      bestS = 0;
    for (const [i, s] of score) {
      const sim = s / Math.min(cg.size, prev[i].g.size);
      if (sim > bestS) {
        bestS = sim;
        bestI = i;
      }
    }
    if (bestI >= 0 && bestS >= 0.8)
      c.reusedFrom = {
        id: prev[bestI].id,
        similarity: Number(bestS.toFixed(3)),
      };
  }
  const n = cands.filter(c => c.reusedFrom).length;
  if (n)
    log(
      `continuity: ${n}/${cands.length} candidate(s) match a ${prevVer} prompt >=0.80 \u2014 reuse that id`
    );

  let w = 0;
  for (const c of cands) {
    if (c.reusedFrom) continue;
    const cg = shingles(collapse(c.body));
    if (!cg.size) continue;
    let bestId = null,
      bestS = 0;
    for (const e of weak) {
      if (!e.g.size) continue;
      let hit = 0;
      for (const g of cg) if (e.g.has(g)) hit++;
      const sim = hit / Math.min(cg.size, e.g.size);
      if (sim > bestS) {
        bestS = sim;
        bestId = e.id;
      }
    }
    if (bestId && bestS >= 0.35) {
      c.possibleSuccessorOf = {
        id: bestId,
        similarity: Number(bestS.toFixed(3)),
      };
      w++;
    }
  }
  if (w)
    log(
      `continuity: ${w} more candidate(s) resemble a REMOVED ${prevVer} id (0.35-0.80) \u2014 advisory possibleSuccessorOf, reuse only on identical role`
    );
}
