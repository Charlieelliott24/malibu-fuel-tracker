const DEFAULT_REPO = "Charlieelliott24/malibu-fuel-tracker";
const DATA_PATH = "data/fuel-log.json";

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,PUT,OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  try {
    if (event.httpMethod === "GET") {
      const file = await fetchGitHubFile();
      return { statusCode: 200, headers, body: file.content };
    }

    if (event.httpMethod === "PUT") {
      const payload = parsePayload(event.body);
      const file = await fetchGitHubFile();
      await saveGitHubFile(JSON.stringify(payload, null, 2) + "\n", file.sha);
      return { statusCode: 200, headers, body: JSON.stringify(payload) };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  } catch (error) {
    return {
      statusCode: error.statusCode || 500,
      headers,
      body: JSON.stringify({ error: error.message || "Sync failed" }),
    };
  }
};

async function fetchGitHubFile() {
  const response = await fetch(gitHubContentsUrl(), {
    headers: gitHubHeaders(),
  });

  if (response.status === 404) {
    return {
      sha: null,
      content: JSON.stringify(defaultPayload()),
    };
  }

  if (!response.ok) {
    throw httpError(`GitHub read failed: ${response.status}`, response.status);
  }

  const body = await response.json();
  return {
    sha: body.sha,
    content: Buffer.from(body.content, "base64").toString("utf8"),
  };
}

async function saveGitHubFile(content, sha) {
  const body = {
    message: "Update shared fuel log",
    content: Buffer.from(content, "utf8").toString("base64"),
    branch: "main",
  };

  if (sha) body.sha = sha;

  const response = await fetch(gitHubContentsUrl(), {
    method: "PUT",
    headers: gitHubHeaders(),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw httpError(`GitHub save failed: ${response.status}`, response.status);
  }
}

function parsePayload(body) {
  const parsed = JSON.parse(body || "{}");
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    settings: parsed.settings && typeof parsed.settings === "object" ? parsed.settings : {},
  };
}

function gitHubContentsUrl() {
  const repo = process.env.GITHUB_REPO || DEFAULT_REPO;
  return `https://api.github.com/repos/${repo}/contents/${DATA_PATH}`;
}

function gitHubHeaders() {
  if (!process.env.GITHUB_TOKEN) {
    throw httpError("Missing GITHUB_TOKEN for cloud sync", 500);
  }

  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function defaultPayload() {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    entries: [],
    settings: {},
  };
}

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
