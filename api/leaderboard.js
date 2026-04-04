const { createClient } = require("redis");

const KEY = "brick-color-splash:leaderboard";
const MAX_ENTRIES = 3;
const MIN_PROMPT_SCORE = 7000;
const MIN_DISPLAY_SCORE = 7500;

function normalizeEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((entry) => entry && typeof entry.name === "string" && Number.isFinite(entry.score))
    .map((entry) => ({
      name: entry.name.trim().replace(/\s+/g, " ").slice(0, 18) || "Joueur",
      score: Math.round(entry.score)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_ENTRIES);
}

async function readEntries() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return null;

  const client = createClient({ url: redisUrl });
  try {
    await client.connect();
    const raw = await client.get(KEY);
    const entries = raw ? JSON.parse(raw) : [];
    return normalizeEntries(entries);
  } catch (error) {
    return null;
  } finally {
    try {
      await client.quit();
    } catch (error) {
    }
  }
}

async function writeEntries(entries) {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("missing_redis_url");
  }

  const client = createClient({ url: redisUrl });
  try {
    await client.connect();
    await client.set(KEY, JSON.stringify(entries));
  } finally {
    try {
      await client.quit();
    } catch (error) {
    }
  }
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch (error) {
      return {};
    }
  }
  return req.body;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    const entries = await readEntries();
    if (entries === null) {
      return res.status(503).json({ ok: false, error: "storage_unavailable" });
    }
    return res.status(200).json({
      ok: true,
      entries,
      visibleEntries: entries.filter((entry) => entry.score > MIN_DISPLAY_SCORE),
      minPromptScore: MIN_PROMPT_SCORE,
      minDisplayScore: MIN_DISPLAY_SCORE
    });
  }

  if (req.method === "POST") {
    const entries = await readEntries();
    if (entries === null) {
      return res.status(503).json({ ok: false, error: "storage_unavailable" });
    }

    const body = parseBody(req);
    const score = Math.round(Number(body.score));
    const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ").slice(0, 18) : "";

    if (!Number.isFinite(score) || !name) {
      return res.status(400).json({ ok: false, error: "invalid_payload", entries });
    }

    if (score <= MIN_PROMPT_SCORE) {
      return res.status(200).json({ ok: true, added: false, entries });
    }

    if (entries.length >= MAX_ENTRIES && score <= entries[entries.length - 1].score) {
      return res.status(200).json({ ok: true, added: false, entries });
    }

    const nextEntries = normalizeEntries(entries.concat({ name, score }));
    await writeEntries(nextEntries);

    return res.status(200).json({
      ok: true,
      added: true,
      entries: nextEntries,
      visibleEntries: nextEntries.filter((entry) => entry.score > MIN_DISPLAY_SCORE)
    });
  }

  return res.status(405).json({ ok: false, error: "method_not_allowed" });
};
