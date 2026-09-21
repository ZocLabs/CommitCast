import path from "node:path";
import { mkdir } from "node:fs/promises";
import { chromium, type Browser } from "playwright";

const MIN_SNIPPET_LINES = 10;
const MAX_SNIPPET_LINES = 15;
const CODE_CARD_FILENAME = "code-card.png";

export type DiffLineKind = "add" | "del" | "ctx";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

export interface CodeCardSnippet {
  filePath: string;
  lines: DiffLine[];
}

export async function renderCodeCard(diff: string): Promise<string> {
  const distDir = path.resolve(process.cwd(), "dist");
  const outputPath = path.join(distDir, CODE_CARD_FILENAME);
  let browser: Browser | undefined;

  try {
    await mkdir(distDir, { recursive: true });
    const snippet = extractRelevantDiffLines(diff);
    const html = buildCodeCardHtml(snippet);

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 1200, height: 900 },
      deviceScaleFactor: 2,
    });

    await page.setContent(html, { waitUntil: "domcontentloaded" });
    const card = page.locator(".code-card");
    await card.waitFor({ state: "visible", timeout: 10_000 });
    await card.screenshot({ path: outputPath });

    return outputPath;
  } catch (error) {
    const message = formatError(error);
    if (message.includes("Executable doesn't exist")) {
      console.error("Playwright Chromium is missing. Run: npx playwright install chromium");
    } else {
      console.error(`Failed to render code snippet card: ${message}`);
    }
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

export function extractRelevantDiffLines(diff: string): CodeCardSnippet {
  const hunks = parseDiffHunks(diff);
  const ranked = [...hunks].sort((a, b) => changedCount(b.lines) - changedCount(a.lines));
  const best = ranked[0];

  if (!best || best.lines.length === 0) {
    return {
      filePath: "commit.diff",
      lines: fallbackLines(diff),
    };
  }

  return {
    filePath: best.filePath,
    lines: selectWindow(best.lines),
  };
}

interface ParsedHunk {
  filePath: string;
  lines: DiffLine[];
}

function parseDiffHunks(diff: string): ParsedHunk[] {
  const hunks: ParsedHunk[] = [];
  let filePath = "snippet";
  let lines: DiffLine[] = [];

  const flush = (): void => {
    if (lines.length > 0) {
      hunks.push({ filePath, lines });
    }
    lines = [];
  };

  for (const rawLine of diff.split(/\r?\n/)) {
    if (rawLine.startsWith("diff --git ")) {
      flush();
      const match = rawLine.match(/ b\/(.+)$/);
      filePath = match?.[1] ?? filePath;
      continue;
    }

    if (rawLine.startsWith("+++ b/")) {
      const nextPath = rawLine.slice("+++ b/".length).trim();
      if (nextPath && nextPath !== "/dev/null") {
        filePath = nextPath;
      }
      continue;
    }

    if (
      rawLine.startsWith("+++ ") ||
      rawLine.startsWith("--- ") ||
      rawLine.startsWith("index ") ||
      rawLine.startsWith("new file") ||
      rawLine.startsWith("deleted file") ||
      rawLine.startsWith("similarity ") ||
      rawLine.startsWith("rename ") ||
      rawLine.startsWith("@@")
    ) {
      continue;
    }

    if (rawLine.startsWith("+")) {
      lines.push({ kind: "add", text: rawLine.slice(1) });
      continue;
    }

    if (rawLine.startsWith("-")) {
      lines.push({ kind: "del", text: rawLine.slice(1) });
      continue;
    }

    if (rawLine.startsWith(" ")) {
      lines.push({ kind: "ctx", text: rawLine.slice(1) });
    }
  }

  flush();
  return hunks;
}

function selectWindow(lines: DiffLine[]): DiffLine[] {
  if (lines.length <= MAX_SNIPPET_LINES) {
    return lines;
  }

  const windowSize = Math.min(MAX_SNIPPET_LINES, Math.max(MIN_SNIPPET_LINES, MAX_SNIPPET_LINES));
  let bestStart = 0;
  let bestScore = -1;

  for (let start = 0; start <= lines.length - windowSize; start += 1) {
    const window = lines.slice(start, start + windowSize);
    const score = changedCount(window);
    if (score > bestScore) {
      bestScore = score;
      bestStart = start;
    }
  }

  return lines.slice(bestStart, bestStart + windowSize);
}

function changedCount(lines: DiffLine[]): number {
  return lines.filter((line) => line.kind !== "ctx").length;
}

function fallbackLines(diff: string): DiffLine[] {
  const lines = diff
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .slice(0, MAX_SNIPPET_LINES)
    .map((text): DiffLine => ({ kind: "ctx", text }));

  return lines.length > 0 ? lines : [{ kind: "ctx", text: "No significant diff lines found" }];
}

function buildCodeCardHtml(snippet: CodeCardSnippet): string {
  const rows = snippet.lines
    .map((line) => {
      const prefix = line.kind === "add" ? "+" : line.kind === "del" ? "−" : " ";
      return `<div class="line ${line.kind}"><span class="gutter">${prefix}</span><span class="code">${escapeHtml(line.text)}</span></div>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body {
        margin: 0;
        background: #070b14;
      }

      .stage {
        display: inline-block;
        padding: 48px;
        background: radial-gradient(circle at top left, #1c2740 0%, #070b14 58%);
      }

      .code-card {
        width: 920px;
        border-radius: 16px;
        overflow: hidden;
        background: #151b28;
        border: 1px solid #2a3347;
        box-shadow: 0 28px 80px rgba(0, 0, 0, 0.45);
        font-family: ui-monospace, "Cascadia Code", "SF Mono", Menlo, Consolas, monospace;
      }

      .titlebar {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 14px 18px;
        background: #1c2333;
        border-bottom: 1px solid #2a3347;
      }

      .dots {
        display: flex;
        gap: 8px;
      }

      .dot {
        width: 12px;
        height: 12px;
        border-radius: 50%;
      }

      .dot.red { background: #ff5f56; }
      .dot.yellow { background: #ffbd2e; }
      .dot.green { background: #27c93f; }

      .filename {
        color: #9aa6c1;
        font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
        font-size: 13px;
        font-weight: 500;
      }

      .body {
        margin: 0;
        padding: 10px 0 16px;
        font-size: 13.5px;
        line-height: 1.7;
      }

      .line {
        display: grid;
        grid-template-columns: 36px 1fr;
        padding: 0 18px 0 0;
      }

      .gutter {
        text-align: center;
        color: #66728a;
        user-select: none;
      }

      .code {
        white-space: pre;
        color: #d7def0;
      }

      .line.add {
        background: rgba(46, 160, 67, 0.16);
      }

      .line.add .gutter,
      .line.add .code {
        color: #7ee787;
      }

      .line.del {
        background: rgba(248, 81, 73, 0.16);
      }

      .line.del .gutter,
      .line.del .code {
        color: #ffa198;
      }
    </style>
  </head>
  <body>
    <div class="stage">
      <div class="code-card">
        <div class="titlebar">
          <div class="dots">
            <span class="dot red"></span>
            <span class="dot yellow"></span>
            <span class="dot green"></span>
          </div>
          <div class="filename">${escapeHtml(snippet.filePath)}</div>
        </div>
        <pre class="body">${rows}</pre>
      </div>
    </div>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
