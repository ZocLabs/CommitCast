import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import type { RepoContext } from "./gitEngine.js";

export interface LinkedInSections {
  problem: string;
  technicalFix: string;
  keyTakeaways: string;
  hashtags: string[];
}

export interface SocialAssets {
  linkedInPost: string;
  linkedInSections: LinkedInSections;
  xThread: string[];
  mermaidDiagram: string;
}

export const socialAssetsSchema = z.object({
  linkedIn: z.object({
    problem: z
      .string()
      .min(140)
      .describe(
        "Section 'The Problem': the concrete engineering pain this commit addresses. Name the failing behavior, the file, and the function or module involved. No motivational filler.",
      ),
    technicalFix: z
      .string()
      .min(180)
      .describe(
        "Section 'The Technical Fix / Architectural Decision': explain the design choice. Quote real symbols from the diff (function names, types, filenames). Describe control flow, not vibes.",
      ),
    keyTakeaways: z
      .string()
      .min(100)
      .describe(
        "Section 'Key Takeaways': 2-4 concrete lessons another engineer can reuse. Reference the actual change. No 'always write clean code' platitudes.",
      ),
    hashtags: z
      .array(z.string().min(2))
      .min(3)
      .max(6)
      .describe("Relevant technical hashtags including the leading #, e.g. #typescript #git."),
  }),
  xThread: z
    .array(z.string().min(1).max(280))
    .length(5)
    .describe(
      "Exactly 5 tweets. 1=hook on the developer problem. 2-4=technical breakdown with short code extracted from the diff. 5=CTA with how to reach the project (npx commitcast, repo name, or a URL found in the README).",
    ),
  mermaidDiagram: z
    .string()
    .min(80)
    .refine(isDetailedMermaid, {
      message:
        "Mermaid must be a data-flow or function-call sequence with at least 4 labeled nodes and labeled edges. Do not emit a 3-box Commit → Tool → Social diagram.",
    })
    .describe(
      "Valid Mermaid flowchart or sequenceDiagram of the DATA FLOW or FUNCTION CALL SEQUENCE in this diff. At least 4-6 nodes, edges labeled like A[Parser] -->|tokenize| B[AST]. No markdown fences. Never a generic Commit/Tool/Social graph.",
    ),
});

const SYSTEM_PROMPT = [
  "You are CommitCast, a staff engineer writing in public.",
  "The audience is senior TypeScript/git engineers. They can smell generic AI copy.",
  "Every sentence must be grounded in the provided commit, files, and diff. Inventing APIs, files, or metrics is a hard failure.",
  "Prefer specific identifiers (getRepoContext, renderMermaidToPng, src/generator.ts) over abstract nouns (pipeline, synergy, leverage).",
  "The product name is CommitCast. Do not use any other tool or product name.",
  "LinkedIn must contain exactly three labeled sections in spirit: The Problem; The Technical Fix / Architectural Decision; Key Takeaways — then hashtags.",
  "X thread is exactly 5 tweets, each ≤ 280 characters. Tweets 2-4 must include a tiny code excerpt copied from the diff (trimmed to fit).",
  "Mermaid must model the real call/data flow introduced by the diff, with 4-6+ nodes and descriptive edge labels. Forbidden: Commit --> Tool --> LinkedIn/X style overviews.",
].join(" ");

export async function generateSocialAssets(context: RepoContext): Promise<SocialAssets> {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || apiKey.trim() === "") {
      throw new Error("Missing required environment variable: ANTHROPIC_API_KEY");
    }

    const { object } = await generateObject({
      model: anthropic("claude-3-5-sonnet-20241022"),
      schema: socialAssetsSchema,
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(context),
    });

    const linkedInSections: LinkedInSections = {
      problem: object.linkedIn.problem.trim(),
      technicalFix: object.linkedIn.technicalFix.trim(),
      keyTakeaways: object.linkedIn.keyTakeaways.trim(),
      hashtags: object.linkedIn.hashtags.map(normalizeHashtag),
    };

    return {
      linkedInSections,
      linkedInPost: formatLinkedInPost(linkedInSections),
      xThread: object.xThread.map((tweet) => tweet.trim()).filter((tweet) => tweet.length > 0),
      mermaidDiagram: stripMermaidFences(object.mermaidDiagram),
    };
  } catch (error) {
    console.error(`Failed to generate social assets: ${formatError(error)}`);
    throw error;
  }
}

function buildPrompt(context: RepoContext): string {
  const files =
    context.filesChanged.length > 0 ? context.filesChanged.map((file) => `- ${file}`).join("\n") : "- (unknown)";

  return `Write CommitCast social assets for this commit. Be specific. Do not summarize at 10,000 feet.

Project: ${context.projectName}
Repository: ${context.repoName}
Description: ${context.description || "(none)"}
Branch: ${context.branch}
Commit: ${context.commitHash}
Author: ${context.authorName}
Message:
${context.commitMessage}

Changed files:
${files}

README excerpt (may contain a repo URL to use in the final tweet CTA):
${context.readme || "(none)"}

Diff (source of truth — extract real function names, filenames, and short code into the posts; capped at 4000 characters):
${context.diff || "(empty diff)"}

Output rules:
1. LinkedIn.problem = The Problem. What broke, scaled poorly, or was missing? Name the file + function.
2. LinkedIn.technicalFix = The Technical Fix / Architectural Decision. Why this shape, not a simpler one? Cite symbols from the diff.
3. LinkedIn.keyTakeaways = reusable engineering notes from THIS change only.
4. X thread length 5. Tweet 1 hook (problem). Tweets 2-4 carry backtick code pulled from the diff. Tweet 5 CTA (npx commitcast or a URL from the README).
5. Mermaid: flowchart or sequenceDiagram of the new data/call flow. Example edge style: A[getRepoContext] -->|truncated diff| B[generateSocialAssets]. Minimum 4 nodes, labeled arrows. Do NOT output: Commit --> CommitCast --> LinkedIn.
`;
}

function formatLinkedInPost(sections: LinkedInSections): string {
  return [
    "The Problem",
    "",
    sections.problem,
    "",
    "The Technical Fix / Architectural Decision",
    "",
    sections.technicalFix,
    "",
    "Key Takeaways",
    "",
    sections.keyTakeaways,
    "",
    sections.hashtags.join(" "),
  ].join("\n");
}

function normalizeHashtag(tag: string): string {
  const trimmed = tag.trim();
  if (trimmed.startsWith("#")) {
    return trimmed;
  }
  return `#${trimmed.replace(/^#+/, "")}`;
}

function isDetailedMermaid(source: string): boolean {
  const cleaned = stripMermaidFences(source);
  const nodeCount = (cleaned.match(/\[[^\]]+\]/g) ?? []).length;
  const edgeCount = (cleaned.match(/-->/g) ?? []).length;
  const labeledEdges = (cleaned.match(/-->\|[^|]+\|/g) ?? []).length;
  const generic = /Commit\s*-->.*(?:LinkedIn|Social|X\b)/i.test(cleaned) && nodeCount <= 3;
  return nodeCount >= 4 && edgeCount >= 3 && labeledEdges >= 2 && !generic;
}

function stripMermaidFences(source: string): string {
  return source
    .trim()
    .replace(/^```mermaid\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
