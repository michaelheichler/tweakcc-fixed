export interface ResolvedSlot {
  token: string;
  expr: string;
  optional: boolean;
}

export const buildContent = (
  body: string,
  slots: ResolvedSlot[]
): {
  expr: string;
  mayBeEmpty: boolean;
} => {
  const ordered = [...slots].sort((a, b) => b.token.length - a.token.length);
  const lines = body.split('\n').map(line => {
    let rendered = '';
    let bare = '';
    let optional = 0;
    let required = 0;
    for (let i = 0; i < line.length; ) {
      if (line[i] === '\\') {
        rendered += line.slice(i, i + 2);
        bare += line.slice(i, i + 2);
        i += 2;
        continue;
      }
      const slot = ordered.find(s => line.startsWith(s.token, i));
      if (slot) {
        rendered += `\${${slot.expr}}`;
        if (slot.optional) optional++;
        else required++;
        i += slot.token.length;
      } else {
        rendered += line[i];
        bare += line[i];
        i++;
      }
    }
    return { rendered, bare, conditional: optional > 0 && required === 0 };
  });
  const mayBeEmpty = slots.some(s => s.optional && body.includes(s.token));
  if (!lines.some(l => l.conditional))
    return {
      expr: '`' + lines.map(l => l.rendered).join('\n') + '`',
      mayBeEmpty,
    };
  const items = lines.map(l =>
    l.conditional ? `[\`${l.rendered}\`,\`${l.bare}\`]` : `\`${l.rendered}\``
  );
  const expr =
    '((L)=>{let o=[];for(let i=0;i<L.length;i++){let x=L[i];' +
    'if(typeof x==="string"){o.push(x);continue}' +
    'if(x[0]!==x[1]){o.push(x[0]);continue}' +
    'if((!o.length||o[o.length-1]==="")&&(i+1>=L.length||L[i+1]===""))' +
    '{if(o.length)o.pop();else i++}}' +
    'return o.join("\\n")})([' +
    items.join(',') +
    '])';
  return { expr, mayBeEmpty };
};

export const emitReminder = (
  wrapFn: string,
  metaFn: string,
  body: string,
  slots: ResolvedSlot[]
): string => {
  const { expr, mayBeEmpty } = buildContent(body, slots);
  const call = (c: string) =>
    `${wrapFn}([${metaFn}({content:${c},isMeta:!0})])`;
  return mayBeEmpty
    ? `((c)=>c.trim()===""?[]:${call('c')})(${expr})`
    : call(expr);
};

export const resolveSlots = (
  patchName: string,
  body: string,
  slots: Array<{
    token: string;
    expr: string | null;
    optional?: boolean;
  }>
): ResolvedSlot[] | null => {
  const out: ResolvedSlot[] = [];
  for (const s of slots) {
    if (!body.includes(s.token)) continue;
    if (s.expr === null) {
      console.error(
        `patch: reminder ${patchName}: no pristine expression for ${s.token}`
      );
      return null;
    }
    out.push({ token: s.token, expr: s.expr, optional: s.optional ?? false });
  }
  return out;
};
