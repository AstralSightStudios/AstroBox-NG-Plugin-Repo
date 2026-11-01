import fs from "node:fs";

const ROOT_INDEX_TXT = "index.txt";
const OUTPUT_INDEX_JSON = "index.json";

function normalizeRawRepoBase(repo) {
  const trimmed = String(repo || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("https://raw.githubusercontent.com/")) {
    return trimmed.replace(/\/+$/, "") + "/";
  }
  if (trimmed.startsWith("https://github.com/")) {
    return (
      trimmed
        .replace(/\/+$/, "")
        .replace(
          "https://github.com/",
          "https://raw.githubusercontent.com/",
        ) + "/refs/heads/main/"
    );
  }
  return trimmed.replace(/\/+$/, "") + "/";
}

function buildFileUrl(repoRaw, folder, file) {
  const normalizedRepo = repoRaw.replace(/\/+$/, "") + "/";
  const normalizedFolder = String(folder || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  const normalizedFile = String(file || "").replace(/^\/+/, "");

  if (!normalizedFolder) {
    return normalizedFile
      ? normalizedRepo + normalizedFile
      : normalizedRepo;
  }

  return normalizedFile
    ? `${normalizedRepo}${normalizedFolder}/${normalizedFile}`
    : `${normalizedRepo}${normalizedFolder}/`;
}

function parseLines(text) {
  return String(text || "")
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "astrobox-plugin-index-bot",
      "Accept": "text/plain,application/json;q=0.9,*/*;q=0.8",
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return await response.text();
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}

function normalizeManifest(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const manifest = {
    name: typeof raw.name === "string" ? raw.name : "",
    icon: typeof raw.icon === "string" ? raw.icon : "",
    version: typeof raw.version === "string" ? raw.version : "",
    description:
      typeof raw.description === "string" ? raw.description : "",
    author: typeof raw.author === "string" ? raw.author : "",
    website: typeof raw.website === "string" ? raw.website : "",
    entry: typeof raw.entry === "string" ? raw.entry : "",
    wasi_version:
      typeof raw.wasi_version === "number"
        ? raw.wasi_version
        : Number(raw.wasi_version || 0),
    api_level:
      typeof raw.api_level === "number"
        ? raw.api_level
        : Number(raw.api_level || 0),
    permissions: Array.isArray(raw.permissions)
      ? raw.permissions.filter((item) => typeof item === "string")
      : [],
    additional_files: Array.isArray(raw.additional_files)
      ? raw.additional_files.filter((item) => typeof item === "string")
      : [],
  };
  return manifest.name ? manifest : null;
}

async function loadRepoEntries(repo) {
  const repoRaw = normalizeRawRepoBase(repo);
  if (!repoRaw) return [];

  const folders = parseLines(await fetchText(`${repoRaw}index.txt`));
  const entries = [];

  for (const folder of folders) {
    try {
      const manifest = normalizeManifest(
        await fetchJson(buildFileUrl(repoRaw, folder, "manifest.json")),
      );
      if (!manifest) {
        console.warn(`[index] invalid manifest in ${repoRaw} :: ${folder}`);
        continue;
      }
      entries.push({
        repo,
        folder,
        manifest,
      });
    } catch (error) {
      console.warn(
        `[index] failed to load manifest for ${repoRaw} :: ${folder}: ${error.message}`,
      );
    }
  }

  return entries;
}

async function main() {
  if (!fs.existsSync(ROOT_INDEX_TXT)) {
    throw new Error(`${ROOT_INDEX_TXT} not found`);
  }

  const repos = parseLines(fs.readFileSync(ROOT_INDEX_TXT, "utf8"));
  const plugins = [];

  for (const repo of repos) {
    try {
      const entries = await loadRepoEntries(repo);
      plugins.push(...entries);
    } catch (error) {
      console.warn(`[index] failed to process repo ${repo}: ${error.message}`);
    }
  }

  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: ROOT_INDEX_TXT,
    plugins,
  };

  fs.writeFileSync(
    OUTPUT_INDEX_JSON,
    JSON.stringify(output, null, 2) + "\n",
    "utf8",
  );

  console.log(`Generated ${OUTPUT_INDEX_JSON} with ${plugins.length} plugin entries.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
