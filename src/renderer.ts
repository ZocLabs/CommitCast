import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, unlink, writeFile } from "node:fs/promises";

const execAsync = promisify(exec);

export async function renderMermaidToPng(mermaidCode: string, outputFilename: string): Promise<string> {
  const distDir = path.resolve(process.cwd(), "dist");
  const outputPath = path.isAbsolute(outputFilename)
    ? outputFilename
    : path.join(distDir, path.basename(outputFilename));
  const tempPath = path.join(distDir, `diagram-${Date.now()}-${process.pid}.mmd`);

  try {
    await mkdir(distDir, { recursive: true });
    await writeFile(tempPath, sanitizeMermaid(mermaidCode), "utf8");

    const command = `npx mmdc -i "${tempPath}" -o "${outputPath}" -b transparent -s 2`;
    await execAsync(command, {
      cwd: process.cwd(),
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    });

    return outputPath;
  } catch (error) {
    console.error(`Failed to render Mermaid diagram with mmdc: ${formatError(error)}`);
    throw error;
  } finally {
    try {
      await unlink(tempPath);
    } catch {
      // Temp file may not exist if mkdir/write failed.
    }
  }
}

function sanitizeMermaid(source: string): string {
  return source
    .trim()
    .replace(/^```mermaid\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function formatError(error: unknown): string {
  if (error && typeof error === "object" && "stderr" in error) {
    const stderr = (error as { stderr?: string }).stderr;
    if (typeof stderr === "string" && stderr.trim() !== "") {
      return stderr.trim();
    }
  }

  return error instanceof Error ? error.message : String(error);
}
