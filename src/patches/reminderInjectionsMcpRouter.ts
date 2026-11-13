import { ReminderInjection } from './reminderShared';
import { topLevelIndex } from './reminderSyntax';
import { showDiff } from './index';

export const MCP_PER_SERVER_ROUTER_INJECTION: ReminderInjection = {
  id: 'mcp-per-server-router',
  name: 'MCP per-server instruction router',
  description:
    "Patches CC's MCP instruction assembly to consult ~/.tweakcc/system-reminders/mcp-<server-name>.md at runtime. Empty body in that file drops the server's block. Body containing {{server_instructions}} resolves to the server's pristine instructions. Custom body replaces. THIS .md does nothing on its own \u2014 it just enables per-server .md files. Empty body = disable this routing (servers use pristine instructions verbatim).",
  placeholders: {},
  defaultBody:
    'This file is a marker that enables per-MCP-server overrides. Edit per-server content in mcp-<server-name>.md alongside this file. Leave this file with content (any content) to enable routing; empty it to disable.',
  bodyIsMarker: true,
  apply(content, _body, isSuppressed) {
    if (isSuppressed) return content;
    const pattern =
      /for\(let ([$\w]+) of ([$\w]+)\)if\(\1\.instructions\)([$\w]+)\.set\(\1\.name,`## \$\{\1\.name\}\n\$\{\1\.instructions\}`\)((?:,[$\w]+\.set\((?:[^()]|\([^()]*\))*\))*);/;
    const match = content.match(pattern);
    if (!match || match.index === undefined) {
      if (content.includes('__tweakccMcpOverride')) return content;
      console.error(
        'patch: reminder mcp-per-server-router: failed to find MCP assembly loop'
      );
      return null;
    }
    const [fullMatch, jVar, zVar, mapVar, extraSets] = match;
    const extraRebound = [
      ...(extraSets || '').matchAll(/[$\w]+\.set\((?:[^()]|\([^()]*\))*\)/g),
    ]
      .map(m => ';' + m[0].split(`${jVar}.instructions`).join('_c'))
      .join('');
    const after = match.index + fullMatch.length;
    const rest = content.slice(after, topLevelIndex(content, after, ''));
    const extraLoop = rest.match(
      /^[^]*?for\(let ([$\w]+) of [$\w]+\)\{(?=if\(![$\w]+\.has\(\1\.serverName\)\))/
    );
    if (!extraLoop && rest.includes('.serverName'))
      console.log(
        "patch: reminder mcp-per-server-router: client-side block loop has a new shape; an emptied mcp-<name>.md will not drop that server's extra block"
      );
    const replacement =
      `function __tweakccMcpOverride(_n,_d){try{` +
      `let _f=require('fs'),_p=require('os').homedir()+'/.tweakcc/system-reminders/mcp-'+_n+'.md';` +
      `let _r=_f.readFileSync(_p,'utf8');` +
      `let _m=_r.match(/-->\\s*([\\s\\S]*?)\\s*$/);` +
      `if(!_m)return _d;` +
      `let _b=_m[1].trim();` +
      `if(_b==='')return null;` +
      `return _b.replace(/\\{\\{server_instructions\\}\\}/g,_d||'')` +
      `}catch{return _d}}` +
      `for(let ${jVar} of ${zVar}){` +
      `let _c=__tweakccMcpOverride(${jVar}.name,${jVar}.instructions);` +
      `if(_c){${mapVar}.set(${jVar}.name,\`## \${${jVar}.name}\n\${_c}\`)${extraRebound}}` +
      `}`;
    let tail = '';
    let end = after;
    if (extraLoop) {
      const rec = extraLoop[1];
      tail =
        extraLoop[0] +
        `if(__tweakccMcpOverride(${rec}.serverName,"")===null)continue;`;
      end = after + extraLoop[0].length;
    }
    const newContent =
      content.slice(0, match.index) + replacement + tail + content.slice(end);
    showDiff(content, newContent, replacement + tail, match.index, end);
    return newContent;
  },
};
