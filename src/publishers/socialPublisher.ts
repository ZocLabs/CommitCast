import { readFile } from "node:fs/promises";
import axios, { type AxiosError } from "axios";
import { TwitterApi, type SendTweetV2Params } from "twitter-api-v2";

const LINKEDIN_REGISTER_UPLOAD_URL = "https://api.linkedin.com/v2/assets?action=registerUpload";
const LINKEDIN_UGC_POSTS_URL = "https://api.linkedin.com/v2/ugcPosts";

interface LinkedInRegisterUploadResponse {
  value: {
    asset: string;
    uploadMechanism: {
      "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest": {
        uploadUrl: string;
        headers?: Record<string, string>;
      };
    };
  };
}

export async function publishToX(thread: string[], imagePath?: string): Promise<void> {
  if (thread.length === 0) {
    throw new Error("X thread is empty. Nothing to publish.");
  }

  try {
    const client = new TwitterApi({
      appKey: requireEnv("TWITTER_API_KEY"),
      appSecret: requireEnv("TWITTER_API_SECRET"),
      accessToken: requireEnv("TWITTER_ACCESS_TOKEN"),
      accessSecret: requireEnv("TWITTER_ACCESS_SECRET"),
    });

    let mediaId: string | undefined;
    if (imagePath) {
      mediaId = await client.v1.uploadMedia(imagePath);
    }

    const tweets: SendTweetV2Params[] = thread.map((text, index) => {
      if (index === 0 && mediaId) {
        return {
          text,
          media: { media_ids: [mediaId] as [string] },
        };
      }

      return { text };
    });

    await client.v2.tweetThread(tweets);
  } catch (error) {
    console.error(`X (Twitter) publish failed: ${formatError(error)}`);
    throw error;
  }
}

export async function publishToLinkedIn(postText: string, imagePath?: string): Promise<void> {
  const accessToken = requireEnv("LINKEDIN_ACCESS_TOKEN");
  const authorUrn = resolveLinkedInAuthorUrn();

  try {
    if (imagePath) {
      const imageBuffer = await readFile(imagePath);
      const assetUrn = await registerAndUploadLinkedInImage(accessToken, authorUrn, imageBuffer);
      await createLinkedInUgcPost(accessToken, authorUrn, postText, assetUrn);
      return;
    }

    await createLinkedInUgcPost(accessToken, authorUrn, postText);
  } catch (error) {
    console.error(`LinkedIn publish failed: ${formatError(error)}`);
    throw error;
  }
}

function resolveLinkedInAuthorUrn(): string {
  const organization = process.env.LINKEDIN_ORGANIZATION_URN?.trim();
  if (organization) {
    return normalizeOrganizationUrn(organization);
  }

  const person = process.env.LINKEDIN_PERSON_URN?.trim();
  if (person) {
    return normalizePersonUrn(person);
  }

  throw new Error(
    "Missing LinkedIn author. Set LINKEDIN_ORGANIZATION_URN (company page) or LINKEDIN_PERSON_URN.",
  );
}

function normalizeOrganizationUrn(value: string): string {
  if (value.startsWith("urn:li:organization:")) {
    return value;
  }
  if (value.startsWith("urn:li:company:")) {
    return value.replace("urn:li:company:", "urn:li:organization:");
  }
  return `urn:li:organization:${value}`;
}

function normalizePersonUrn(value: string): string {
  return value.startsWith("urn:li:person:") ? value : `urn:li:person:${value}`;
}

async function registerAndUploadLinkedInImage(
  accessToken: string,
  authorUrn: string,
  imageBuffer: Buffer,
): Promise<string> {
  let registerResponse: LinkedInRegisterUploadResponse;

  try {
    const { data } = await axios.post<LinkedInRegisterUploadResponse>(
      LINKEDIN_REGISTER_UPLOAD_URL,
      {
        registerUploadRequest: {
          recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
          owner: authorUrn,
          serviceRelationships: [
            {
              relationshipType: "OWNER",
              identifier: "urn:li:userGeneratedContent",
            },
          ],
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-Restli-Protocol-Version": "2.0.0",
        },
      },
    );
    registerResponse = data;
  } catch (error) {
    console.error(`LinkedIn registerUpload request failed: ${formatAxiosError(error)}`);
    throw error;
  }

  const assetUrn = registerResponse.value?.asset;
  const upload =
    registerResponse.value?.uploadMechanism?.["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"];

  if (!assetUrn || !upload?.uploadUrl) {
    throw new Error("LinkedIn registerUpload did not return an asset URN and upload URL.");
  }

  try {
    await axios.put(upload.uploadUrl, imageBuffer, {
      headers: {
        "Content-Type": "application/octet-stream",
        ...(upload.headers ?? {}),
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
  } catch (error) {
    console.error(`LinkedIn image binary upload failed: ${formatAxiosError(error)}`);
    throw error;
  }

  return assetUrn;
}

async function createLinkedInUgcPost(
  accessToken: string,
  authorUrn: string,
  postText: string,
  assetUrn?: string,
): Promise<void> {
  const shareContent = assetUrn
    ? {
        shareCommentary: { text: postText },
        shareMediaCategory: "IMAGE",
        media: [
          {
            status: "READY",
            description: { text: "Commit architecture diagram" },
            media: assetUrn,
            title: { text: "CommitCast diagram" },
          },
        ],
      }
    : {
        shareCommentary: { text: postText },
        shareMediaCategory: "NONE",
      };

  try {
    await axios.post(
      LINKEDIN_UGC_POSTS_URL,
      {
        author: authorUrn,
        lifecycleState: "PUBLISHED",
        specificContent: {
          "com.linkedin.ugc.ShareContent": shareContent,
        },
        visibility: {
          "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-Restli-Protocol-Version": "2.0.0",
        },
      },
    );
  } catch (error) {
    console.error(`LinkedIn /v2/ugcPosts request failed: ${formatAxiosError(error)}`);
    throw error;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function formatAxiosError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<unknown>;
    const status = axiosError.response?.status;
    const data = axiosError.response?.data;
    const details = typeof data === "string" ? data : data ? JSON.stringify(data) : axiosError.message;
    return status ? `HTTP ${status} ${details}` : details;
  }

  return formatError(error);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
