import * as fs from 'node:fs/promises';
import * as path from 'path';
import { SYSTEM_PROMPTS_DIR } from './config';

const computeWordDiff = (
  oldText: string,
  newText: string
): {
  oldHtml: string;
  newHtml: string;
} => {
  const tokenize = (text: string): string[] => {
    return text.split(/(\s+)/);
  };
  const oldTokens = tokenize(oldText);
  const newTokens = tokenize(newText);
  const m = oldTokens.length;
  const n = newTokens.length;
  const lcs: number[][] = Array(m + 1)
    .fill(0)
    .map(() => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldTokens[i - 1] === newTokens[j - 1]) {
        lcs[i][j] = lcs[i - 1][j - 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i - 1][j], lcs[i][j - 1]);
      }
    }
  }
  const oldChanged: boolean[] = Array(m).fill(false);
  const newChanged: boolean[] = Array(n).fill(false);
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldTokens[i - 1] === newTokens[j - 1]) {
      i--;
      j--;
    } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
      newChanged[j - 1] = true;
      j--;
    } else if (i > 0) {
      oldChanged[i - 1] = true;
      i--;
    }
  }
  const escapeHtml = (text: string) =>
    text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  let oldHtml = '';
  for (let k = 0; k < oldTokens.length; k++) {
    const token = escapeHtml(oldTokens[k]);
    oldHtml += oldChanged[k] ? `<mark>${token}</mark>` : token;
  }
  let newHtml = '';
  for (let k = 0; k < newTokens.length; k++) {
    const token = escapeHtml(newTokens[k]);
    newHtml += newChanged[k] ? `<mark>${token}</mark>` : token;
  }
  return { oldHtml, newHtml };
};

const computeDiff = (
  oldLines: string[],
  newLines: string[]
): Array<{
  type: 'unchanged' | 'removed' | 'added' | 'modified';
  line: string;
  oldLineNo?: number;
  newLineNo?: number;
  oldHtml?: string;
  newHtml?: string;
}> => {
  const m = oldLines.length;
  const n = newLines.length;
  const lcs: number[][] = Array(m + 1)
    .fill(0)
    .map(() => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        lcs[i][j] = lcs[i - 1][j - 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i - 1][j], lcs[i][j - 1]);
      }
    }
  }
  const diff: Array<{
    type: 'unchanged' | 'removed' | 'added' | 'modified';
    line: string;
    oldLineNo?: number;
    newLineNo?: number;
    oldHtml?: string;
    newHtml?: string;
  }> = [];
  let i = m;
  let j = n;
  const tempDiff: Array<{
    type: 'unchanged' | 'removed' | 'added';
    line: string;
    oldLineNo?: number;
    newLineNo?: number;
  }> = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      tempDiff.unshift({
        type: 'unchanged',
        line: oldLines[i - 1],
        oldLineNo: i,
        newLineNo: j,
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
      tempDiff.unshift({ type: 'added', line: newLines[j - 1], newLineNo: j });
      j--;
    } else if (i > 0) {
      tempDiff.unshift({
        type: 'removed',
        line: oldLines[i - 1],
        oldLineNo: i,
      });
      i--;
    }
  }
  for (let k = 0; k < tempDiff.length; k++) {
    const current = tempDiff[k];
    const next = tempDiff[k + 1];
    if (current.type === 'removed' && next?.type === 'added') {
      const wordDiff = computeWordDiff(current.line, next.line);
      diff.push({
        type: 'modified',
        line: current.line,
        oldLineNo: current.oldLineNo,
        newLineNo: next.newLineNo,
        oldHtml: wordDiff.oldHtml,
        newHtml: wordDiff.newHtml,
      });
      k++;
    } else {
      diff.push(current);
    }
  }
  return diff;
};

export const generateDiffHtml = async (
  promptId: string,
  promptName: string,
  oldBaselineContent: string,
  userContent: string,
  newBaselineContent: string,
  oldVersion: string,
  newVersion: string,
  markdownFilePath: string
): Promise<string> => {
  const oldBaselineLines = oldBaselineContent.split('\n');
  const userLines = userContent.split('\n');
  const newBaselineLines = newBaselineContent.split('\n');
  const escapeHtml = (text: string) =>
    text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  const userDiff = computeDiff(oldBaselineLines, userLines);
  const upstreamDiff = computeDiff(oldBaselineLines, newBaselineLines);
  let userDiffHtml = '';
  for (const entry of userDiff) {
    const escapedLine = escapeHtml(entry.line);
    if (entry.type === 'modified') {
      const oldLineNum = entry.oldLineNo
        ? String(entry.oldLineNo).padStart(4, ' ')
        : '    ';
      const newLineNum = entry.newLineNo
        ? String(entry.newLineNo).padStart(4, ' ')
        : '    ';
      userDiffHtml += `<div class="line removed"><span class="line-num">${oldLineNum}</span><span class="prefix">- </span>${entry.oldHtml}</div>\n`;
      userDiffHtml += `<div class="line added"><span class="line-num">${newLineNum}</span><span class="prefix">+ </span>${entry.newHtml}</div>\n`;
    } else if (entry.type === 'removed') {
      const lineNum = entry.oldLineNo
        ? String(entry.oldLineNo).padStart(4, ' ')
        : '    ';
      userDiffHtml += `<div class="line removed"><span class="line-num">${lineNum}</span><span class="prefix">- </span>${escapedLine}</div>\n`;
    } else if (entry.type === 'added') {
      const lineNum = entry.newLineNo
        ? String(entry.newLineNo).padStart(4, ' ')
        : '    ';
      userDiffHtml += `<div class="line added"><span class="line-num">${lineNum}</span><span class="prefix">+ </span>${escapedLine}</div>\n`;
    } else {
      const oldLineNum = entry.oldLineNo
        ? String(entry.oldLineNo).padStart(4, ' ')
        : '    ';
      const newLineNum = entry.newLineNo
        ? String(entry.newLineNo).padStart(4, ' ')
        : '    ';
      userDiffHtml += `<div class="line unchanged"><span class="line-num">${oldLineNum} ${newLineNum}</span><span class="prefix">  </span>${escapedLine}</div>\n`;
    }
  }
  let upstreamDiffHtml = '';
  for (const entry of upstreamDiff) {
    const escapedLine = escapeHtml(entry.line);
    if (entry.type === 'modified') {
      const oldLineNum = entry.oldLineNo
        ? String(entry.oldLineNo).padStart(4, ' ')
        : '    ';
      const newLineNum = entry.newLineNo
        ? String(entry.newLineNo).padStart(4, ' ')
        : '    ';
      upstreamDiffHtml += `<div class="line removed"><span class="line-num">${oldLineNum}</span><span class="prefix">- </span>${entry.oldHtml}</div>\n`;
      upstreamDiffHtml += `<div class="line added"><span class="line-num">${newLineNum}</span><span class="prefix">+ </span>${entry.newHtml}</div>\n`;
    } else if (entry.type === 'removed') {
      const lineNum = entry.oldLineNo
        ? String(entry.oldLineNo).padStart(4, ' ')
        : '    ';
      upstreamDiffHtml += `<div class="line removed"><span class="line-num">${lineNum}</span><span class="prefix">- </span>${escapedLine}</div>\n`;
    } else if (entry.type === 'added') {
      const lineNum = entry.newLineNo
        ? String(entry.newLineNo).padStart(4, ' ')
        : '    ';
      upstreamDiffHtml += `<div class="line added"><span class="line-num">${lineNum}</span><span class="prefix">+ </span>${escapedLine}</div>\n`;
    } else {
      const oldLineNum = entry.oldLineNo
        ? String(entry.oldLineNo).padStart(4, ' ')
        : '    ';
      const newLineNum = entry.newLineNo
        ? String(entry.newLineNo).padStart(4, ' ')
        : '    ';
      upstreamDiffHtml += `<div class="line unchanged"><span class="line-num">${oldLineNum} ${newLineNum}</span><span class="prefix">  </span>${escapedLine}</div>\n`;
    }
  }
  const diffHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Diff: ${escapeHtml(promptName)} (${escapeHtml(promptId)})</title>
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      margin: 0;
      padding: 20px;
      background: #f5f5f5;
    }
    .header {
      background: white;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    h1 {
      margin: 0 0 10px 0;
      color: #333;
    }
    .version-info {
      color: #666;
      font-size: 14px;
    }
    .warning {
      background: #fff3cd;
      border-left: 4px solid #ffc107;
      padding: 15px;
      margin-bottom: 20px;
      border-radius: 4px;
    }
    .warning code {
      background: rgba(0,0,0,0.1);
      padding: 2px 6px;
      border-radius: 3px;
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 13px;
    }
    .diff-panels {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 20px;
    }
    .diff-container {
      background: white;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .diff-header {
      background: #f8f9fa;
      padding: 12px 15px;
      font-weight: bold;
      border-bottom: 2px solid #dee2e6;
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 14px;
    }
    .diff-content {
      padding: 0;
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 13px;
      line-height: 1.5;
      overflow-x: auto;
      max-height: 600px;
      overflow-y: auto;
    }
    .line {
      padding: 2px 10px;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .line .line-num {
      display: inline-block;
      min-width: 50px;
      margin-right: 10px;
      color: #6a737d;
      text-align: right;
      user-select: none;
      font-size: 12px;
    }
    .line .prefix {
      display: inline-block;
      width: 20px;
      font-weight: bold;
      user-select: none;
    }
    .removed {
      background: #ffebe9;
      color: #24292e;
    }
    .removed .prefix {
      color: #d73a49;
    }
    .added {
      background: #e6ffed;
      color: #24292e;
    }
    .added .prefix {
      color: #22863a;
    }
    .unchanged {
      background: #ffffff;
      color: #24292e;
    }
    .unchanged .prefix {
      color: #6a737d;
    }
    mark {
      background: rgba(255, 200, 0, 0.4);
      padding: 0;
      border-radius: 2px;
    }
    .removed mark {
      background: rgba(215, 58, 73, 0.3);
    }
    .added mark {
      background: rgba(34, 134, 58, 0.3);
    }
    @media (max-width: 1200px) {
      .diff-panels {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(promptName)}</h1>
    <div class="version-info">
      <strong>Old Version:</strong> ${escapeHtml(oldVersion)} →
      <strong>New Version:</strong> ${escapeHtml(newVersion)}
    </div>
  </div>

  <div class="warning">
    <strong>⚠️ Version Mismatch Warning</strong><br>
    Your customized prompt file is based on version ${escapeHtml(oldVersion)},
    but Claude Code is now using version ${escapeHtml(newVersion)}.
    Review the differences below to understand both your customizations and the upstream changes.<br><br>
    <strong>File:</strong> <code>${escapeHtml(markdownFilePath)}</code><br><br>
    When you're done reviewing, update the <code>ccVersion</code> in the file to <strong>${escapeHtml(newVersion)}</strong>.
  </div>

  <div class="diff-panels">
    <div class="diff-container">
      <div class="diff-header">Your Customizations (v${escapeHtml(oldVersion)} → User)</div>
      <div class="diff-content">
${userDiffHtml}      </div>
    </div>

    <div class="diff-container">
      <div class="diff-header">Upstream Changes (v${escapeHtml(oldVersion)} → v${escapeHtml(newVersion)})</div>
      <div class="diff-content">
${upstreamDiffHtml}      </div>
    </div>
  </div>
</body>
</html>`;
  const htmlPath = path.join(SYSTEM_PROMPTS_DIR, `${promptId}.diff.html`);
  await fs.writeFile(htmlPath, diffHtml, 'utf-8');
  return htmlPath;
};
export { computeWordDiff, computeDiff };
