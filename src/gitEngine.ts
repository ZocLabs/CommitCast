import path from "node:path";
import { readFile } from "node:fs/promises";
import { simpleGit, type SimpleGit } from "simple-git";

const MAX_DIFF_CHARS = 4000;
const MAX_README_CHARS = 3000;

export interface PackageContext {
  name: string;
  description: string;
}

export interface RepoContext {
  repoName: string;
  projectName: string;
  description: string;
  branch: string;
  commitHash: string;
  commitMessage: string;
  authorName: string;
  filesChanged: string[];
  diff: string;
  readme: string;
}

interface PackageManifest {
  name?: string;
  description?: string;
}

export async function getRepoContext(): Promise<RepoContext> {
  const git: SimpleGit = simpleGit();

  try {
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      throw new Error("This directory is not a git repository. Run CommitCast from a repo root.");
    }
  } catch (error) {
    console.error(`Git repository check failed: ${formatError(error)}`);
    throw error;
  }

  try {
    const [repoRootRaw, branchRaw, log] = await Promise.all([
      git.revparse(["--show-toplevel"]),
      git.revparse(["--abbrev-ref", "HEAD"]),
      git.log({ maxCount: 1 }),
    ]);

    const repoRoot = repoRootRaw.trim();
    const latest = log.latest;
    if (!latest) {
      throw new Error("No commits found. Make a commit before running CommitCast.");
    }

    const [diff, filesChanged, readme, pkg] = await Promise.all([
      readLatestDiff(git),
      readChangedFiles(git),
      readReadme(repoRoot),
      readPackageContext(repoRoot),
    ]);

    const repoName = path.basename(repoRoot);

    return {
      repoName,
      projectName: pkg.name || repoName,
      description: pkg.description,
      branch: branchRaw.trim(),
      commitHash: latest.hash,
      commitMessage: latest.message.trim(),
      authorName: latest.author_name,
      filesChanged,
      diff: truncate(diff, MAX_DIFF_CHARS),
      readme: truncate(readme, MAX_README_CHARS),
    };
  } catch (error) {
    console.error(`Failed to extract repository context: ${formatError(error)}`);
    throw error;
  }
}

async function readLatestDiff(git: SimpleGit): Promise<string> {
  try {
    return await git.show(["HEAD", "--format=", "--patch"]);
  } catch (error) {
    console.error(`Failed to read git show diff for HEAD: ${formatError(error)}`);
    throw error;
  }
}

async function readChangedFiles(git: SimpleGit): Promise<string[]> {
  try {
    const names = await git.show(["HEAD", "--name-only", "--pretty=format:"]);
    return names
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch (error) {
    console.error(`Failed to list files from the latest commit: ${formatError(error)}`);
    return [];
  }
}

async function readReadme(repoRoot: string): Promise<string> {
  const candidates = ["README.md", "README", "readme.md"];

  for (const candidate of candidates) {
    try {
      return await readFile(path.join(repoRoot, candidate), "utf8");
    } catch {
      continue;
    }
  }

  return "";
}

async function readPackageContext(repoRoot: string): Promise<PackageContext> {
  try {
    const raw = await readFile(path.join(repoRoot, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as PackageManifest;
    return {
      name: typeof parsed.name === "string" ? parsed.name : "",
      description: typeof parsed.description === "string" ? parsed.description : "",
    };
  } catch {
    return { name: "", description: "" };
  }
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  const omitted = value.length - maxChars;
  return `${value.slice(0, maxChars)}\n\n[truncated ${omitted} characters]`;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
