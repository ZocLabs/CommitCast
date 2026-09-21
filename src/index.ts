#!/usr/bin/env node
import "dotenv/config";
import { exec } from "node:child_process";
import { createReadStream } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import { checkbox, select } from "@inquirer/prompts";
import { Command } from "commander";
import { renderCodeCard } from "./codeRenderer.js";
import { generateSocialAssets, type SocialAssets } from "./generator.js";
import { getRepoContext, type RepoContext } from "./gitEngine.js";
import { publishToLinkedIn, publishToX } from "./publishers/socialPublisher.js";
import { renderMermaidToPng } from "./renderer.js";

const execAsync = promisify(exec);

type PublishPlatform = "linkedin" | "x";
type PublishAction = "publish" | "regenerate" | "cancel";

interface CliOptions {
  yes?: boolean;
  dryRun?: boolean;
}

interface PipelineOptions {
  autoPublish: boolean;
  dryRun: boolean;
}

interface GeneratedAssets extends SocialAssets {
  diagramPath: string;
  codeCardPath: string;
}

const DIAGRAM_FILENAME = "commit-diagram.png";
const CODE_CARD_FILENAME = "code-card.png";
const PREVIEW_FILENAME = "preview.html";
const PREVIEW_PORT = 4173;
const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}/${PREVIEW_FILENAME}`;

async function main(argv: string[] = process.argv): Promise<void> {
  const program = new Command();

  program
    .name("commitcast")
    .description("Turn git commits into LinkedIn posts, X threads, and architecture diagrams.")
    .version("1.0.0")
    .option("-y, --yes", "Skip interactive confirmation and publish to LinkedIn and X")
    .option("-d, --dry-run", "Generate a local HTML preview and skip publishing")
    .action(async (options: CliOptions) => {
      await runPipeline({
        autoPublish: Boolean(options.yes),
        dryRun: Boolean(options.dryRun),
      });
    });

  await program.parseAsync(argv);
}

async function runPipeline(options: PipelineOptions): Promise<void> {
  const context = await getRepoContext();
  let assets = await generateAndRender(context);

  if (options.dryRun) {
    printPreview(assets);
    await writeAndOpenHtmlPreview(assets);
    return;
  }

  if (options.autoPublish || !process.stdin.isTTY) {
    await publishSelected(assets, ["linkedin", "x"]);
    return;
  }

  let platforms: PublishPlatform[] = ["linkedin", "x"];

  while (true) {
    printPreview(assets);

    platforms = await checkbox<PublishPlatform>({
      message: "Destination platforms",
      required: true,
      choices: [
        { name: "LinkedIn", value: "linkedin", checked: platforms.includes("linkedin") },
        { name: "X (Twitter)", value: "x", checked: platforms.includes("x") },
      ],
    });

    const action = await select<PublishAction>({
      message: "What next?",
      choices: [
        { name: "Publish Now", value: "publish" },
        { name: "Regenerate", value: "regenerate" },
        { name: "Cancel", value: "cancel" },
      ],
    });

    if (action === "cancel") {
      console.log("Cancelled. Nothing was published.");
      return;
    }

    if (action === "regenerate") {
      assets = await generateAndRender(context);
      continue;
    }

    await publishSelected(assets, platforms);
    return;
  }
}

async function generateAndRender(context: RepoContext): Promise<GeneratedAssets> {
  console.log(`Generating posts from ${context.commitHash.slice(0, 7)} on ${context.branch}...`);

  const assets = await generateSocialAssets(context);
  const [diagramPath, codeCardPath] = await Promise.all([
    renderMermaidToPng(assets.mermaidDiagram, DIAGRAM_FILENAME),
    renderCodeCard(context.diff),
  ]);
  console.log(`Diagram saved to ${diagramPath}`);
  console.log(`Code card saved to ${codeCardPath}`);

  return { ...assets, diagramPath, codeCardPath };
}

function printPreview(assets: GeneratedAssets): void {
  console.log("\n━━ LinkedIn post ━━━━━━━━━━━━━━━━━━━━━━\n");
  console.log(assets.linkedInPost);
  console.log("\n━━ X thread ━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  assets.xThread.forEach((tweet, index) => {
    console.log(`${index + 1}/${assets.xThread.length} ${tweet}\n`);
  });
  console.log("━━ Rendered assets ━━━━━━━━━━━━━━━━━━━━");
  console.log(`Diagram:   ${assets.diagramPath}`);
  console.log(`Code card: ${assets.codeCardPath}\n`);
}

async function publishSelected(assets: GeneratedAssets, platforms: PublishPlatform[]): Promise<void> {
  if (platforms.length === 0) {
    console.error("No platforms selected. Nothing was published.");
    return;
  }

  for (const platform of platforms) {
    try {
      if (platform === "linkedin") {
        await publishToLinkedIn(assets.linkedInPost, assets.diagramPath);
        console.log("Published to LinkedIn.");
      } else {
        await publishToX(assets.xThread, assets.diagramPath);
        console.log("Published to X.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Skipping ${platform === "linkedin" ? "LinkedIn" : "X"}: ${message}`);
    }
  }
}

async function writeAndOpenHtmlPreview(assets: GeneratedAssets): Promise<void> {
  const distDir = path.resolve(process.cwd(), "dist");
  const previewPath = path.join(distDir, PREVIEW_FILENAME);

  try {
    await mkdir(distDir, { recursive: true });
    const html = await buildPreviewHtml(assets);
    await writeFile(previewPath, html, "utf8");
    console.log(`Dry run: skipped publishing. Preview written to ${previewPath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to write HTML preview: ${message}`);
    throw error;
  }

  await startPreviewServer(distDir, PREVIEW_PORT);
  await openInDefaultBrowser(PREVIEW_URL);
  console.log(`Preview: ${PREVIEW_URL}`);

  if (process.stdin.isTTY) {
    console.log("Press Ctrl+C to stop the preview server.");
    await waitForInterrupt();
  }
}

async function buildPreviewHtml(assets: GeneratedAssets): Promise<string> {
  const [hasDiagram, hasCodeCard] = await Promise.all([
    fileExists(assets.diagramPath),
    fileExists(assets.codeCardPath),
  ]);
  const sections = assets.linkedInSections;
  const problemHtml = toHtmlParagraphs(sections.problem);
  const fixHtml = toHtmlParagraphs(sections.technicalFix);
  const takeawaysHtml = toHtmlParagraphs(sections.keyTakeaways);
  const hashtagHtml = sections.hashtags
    .map((tag) => `<span class="hashtag">${escapeHtml(tag)}</span>`)
    .join("");
  const tweets = assets.xThread
    .map((tweet, index) => {
      const body = escapeHtml(tweet).replace(/\r?\n/g, "<br />");
      return `
        <article class="tweet glass">
          <div class="tweet-meta">
            <span class="avatar x-avatar">CC</span>
            <div>
              <strong>CommitCast</strong>
              <span class="handle">@commitcast · ${index + 1}/${assets.xThread.length}</span>
            </div>
          </div>
          <p>${body}</p>
        </article>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>CommitCast dry-run preview</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #070a12;
        --glass: rgba(16, 22, 36, 0.58);
        --glass-border: rgba(255, 255, 255, 0.1);
        --text: #eef3ff;
        --muted: #9aa6c1;
        --linkedin: #0a66c2;
        --x: #e7e9ea;
        --accent: #7c5cff;
      }

      * { box-sizing: border-box; }

      html, body {
        margin: 0;
        min-height: 100%;
        color: var(--text);
        font-family: "Segoe UI", Inter, system-ui, sans-serif;
        background:
          radial-gradient(circle at 12% -10%, rgba(124, 92, 255, 0.28), transparent 42%),
          radial-gradient(circle at 90% 0%, rgba(10, 102, 194, 0.22), transparent 38%),
          linear-gradient(180deg, #101627 0%, var(--bg) 48%);
      }

      .page {
        max-width: 1120px;
        margin: 0 auto;
        padding: 40px 24px 72px;
      }

      header.hero {
        display: flex;
        align-items: center;
        gap: 16px;
        margin-bottom: 28px;
        padding: 18px 20px;
        border-radius: 20px;
        background: var(--glass);
        border: 1px solid var(--glass-border);
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
      }

      .brand-mark {
        width: 46px;
        height: 46px;
        border-radius: 14px;
        display: grid;
        place-items: center;
        background: linear-gradient(135deg, #7c5cff, #0a66c2);
        font-weight: 800;
        letter-spacing: 0.04em;
      }

      header.hero h1 {
        margin: 0 0 4px;
        font-size: 24px;
      }

      header.hero p {
        margin: 0;
        color: var(--muted);
      }

      .grid {
        display: grid;
        grid-template-columns: 1.15fr 0.85fr;
        gap: 18px;
      }

      .glass {
        background: var(--glass);
        border: 1px solid var(--glass-border);
        border-radius: 20px;
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.28);
      }

      .card {
        padding: 20px 22px 22px;
      }

      .card.full {
        grid-column: 1 / -1;
      }

      .card-label {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 11px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--muted);
        margin-bottom: 16px;
      }

      .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
      }

      .dot.linkedin { background: var(--linkedin); }
      .dot.x { background: var(--x); }
      .dot.diagram { background: var(--accent); }

      .identity {
        display: flex;
        gap: 12px;
        align-items: center;
        margin-bottom: 16px;
      }

      .avatar {
        width: 42px;
        height: 42px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        font-weight: 700;
        font-size: 13px;
      }

      .li-avatar { background: var(--linkedin); }
      .x-avatar { background: #111; border: 1px solid rgba(255,255,255,0.12); }

      .identity small, .handle {
        display: block;
        color: var(--muted);
        font-weight: 400;
        font-size: 13px;
      }

      .li-section + .li-section {
        margin-top: 16px;
        padding-top: 16px;
        border-top: 1px solid rgba(255,255,255,0.08);
      }

      .li-section h3 {
        margin: 0 0 8px;
        font-size: 13px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #c5b6ff;
      }

      .li-section p {
        margin: 0;
        line-height: 1.65;
      }

      .hashtags {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 16px;
      }

      .hashtag {
        padding: 4px 10px;
        border-radius: 999px;
        background: rgba(124, 92, 255, 0.16);
        border: 1px solid rgba(124, 92, 255, 0.28);
        font-size: 12px;
        color: #d7ccff;
      }

      .thread {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .tweet {
        padding: 14px;
      }

      .tweet p {
        margin: 0;
        line-height: 1.65;
        white-space: pre-wrap;
      }

      .tweet-meta {
        display: flex;
        gap: 10px;
        align-items: center;
        margin-bottom: 10px;
      }

      .diagram-wrap {
        background: rgba(8, 12, 22, 0.55);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 14px;
        padding: 16px;
        text-align: center;
      }

      .diagram-wrap img {
        max-width: 100%;
        height: auto;
        border-radius: 8px;
      }

      .missing {
        color: var(--muted);
        margin: 24px 0;
      }

      @media (max-width: 860px) {
        .grid { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <header class="hero">
        <div class="brand-mark">CC</div>
        <div>
          <h1>CommitCast dry-run preview</h1>
          <p>Local preview only. LinkedIn and X were not published.</p>
        </div>
      </header>
      <section class="grid">
        <article class="card glass">
          <div class="card-label"><span class="dot linkedin"></span> LinkedIn</div>
          <div class="identity">
            <span class="avatar li-avatar">CC</span>
            <div>
              <strong>CommitCast</strong>
              <small>Developer advocate · Just now</small>
            </div>
          </div>
          <section class="li-section">
            <h3>The Problem</h3>
            ${problemHtml}
          </section>
          <section class="li-section">
            <h3>The Technical Fix / Architectural Decision</h3>
            ${fixHtml}
          </section>
          <section class="li-section">
            <h3>Key Takeaways</h3>
            ${takeawaysHtml}
          </section>
          <div class="hashtags">${hashtagHtml}</div>
        </article>
        <article class="card glass">
          <div class="card-label"><span class="dot x"></span> X thread</div>
          <div class="thread">
            ${tweets}
          </div>
        </article>
        <article class="card glass full">
          <div class="card-label"><span class="dot diagram"></span> Architecture diagram</div>
          <div class="diagram-wrap">
            ${
              hasDiagram
                ? `<img src="./${DIAGRAM_FILENAME}" alt="CommitCast architecture diagram from dist/${DIAGRAM_FILENAME}" />`
                : `<p class="missing">Diagram PNG was not available to embed.</p>`
            }
          </div>
        </article>
        <article class="card glass full">
          <div class="card-label"><span class="dot diagram"></span> Code snippet</div>
          <div class="diagram-wrap">
            ${
              hasCodeCard
                ? `<img src="./${CODE_CARD_FILENAME}" alt="Generated code snippet card" />`
                : `<p class="missing">Code card PNG was not available to embed.</p>`
            }
          </div>
        </article>
      </section>
    </div>
  </body>
</html>
`;
}

function toHtmlParagraphs(text: string): string {
  const escaped = escapeHtml(text).replace(/\r?\n/g, "<br />");
  return `<p>${escaped}</p>`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function startPreviewServer(distDir: string, port: number): Promise<void> {
  const server = createServer((request, response) => {
    handlePreviewRequest(distDir, request, response);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        console.log(`Port ${port} is already in use. Opening the existing preview.`);
        resolve();
        return;
      }

      console.error(`Failed to start preview server: ${error.message}`);
      reject(error);
    });

    server.listen(port, "127.0.0.1", () => {
      resolve();
    });
  });
}

function handlePreviewRequest(
  distDir: string,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  try {
    const requested = new URL(request.url ?? "/", PREVIEW_URL);
    if (requested.pathname === "/" || requested.pathname === "") {
      response.writeHead(302, { Location: `/${PREVIEW_FILENAME}` });
      response.end();
      return;
    }

    const relativePath = decodeURIComponent(requested.pathname).replace(/^\/+/, "");
    const absolutePath = path.resolve(distDir, relativePath);
    const distRoot = `${path.resolve(distDir)}${path.sep}`;
    if (absolutePath !== path.resolve(distDir) && !absolutePath.startsWith(distRoot)) {
      response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Forbidden");
      return;
    }

    const stream = createReadStream(absolutePath);
    stream.on("open", () => {
      response.writeHead(200, { "Content-Type": contentTypeFor(absolutePath) });
      stream.pipe(response);
    });
    stream.on("error", () => {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Preview server request failed: ${message}`);
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Preview server error");
  }
}

function contentTypeFor(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".html") {
    return "text/html; charset=utf-8";
  }
  if (extension === ".png") {
    return "image/png";
  }
  if (extension === ".svg") {
    return "image/svg+xml";
  }
  if (extension === ".css") {
    return "text/css; charset=utf-8";
  }
  return "application/octet-stream";
}

async function openInDefaultBrowser(targetUrl: string): Promise<void> {
  const command = browserOpenCommand(targetUrl);

  try {
    await execAsync(command, { windowsHide: true });
    console.log(`Opened ${targetUrl} in your default browser.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Could not open the preview in a browser: ${message}`);
    console.error(`Open this URL manually: ${targetUrl}`);
  }
}

function browserOpenCommand(targetUrl: string): string {
  if (process.platform === "darwin") {
    return `open "${targetUrl}"`;
  }

  if (process.platform === "win32") {
    return `start "" "${targetUrl}"`;
  }

  return `xdg-open "${targetUrl}"`;
}

async function waitForInterrupt(): Promise<void> {
  await new Promise<void>((resolve) => {
    const stop = (): void => {
      process.off("SIGINT", stop);
      resolve();
    };
    process.on("SIGINT", stop);
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
