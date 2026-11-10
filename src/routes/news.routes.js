import { Router } from "express";

const router = Router();

const SANITY_PROJECT_ID = process.env.SANITY_PROJECT_ID || "yi1d1k89";
const SANITY_DATASET = process.env.SANITY_DATASET || "production";
const SANITY_API_VERSION = "v2024-03-15";

// 5-minute in-memory cache so 300+ Companion clients don't exhaust Sanity API quota
let cachedArticles = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

const ARTICLES_GROQ = `*[_type == "article" && defined(slug.current) && !(_id in path("drafts.**"))] | order(publishedAt desc) {
  _id,
  title,
  slug,
  publishedAt,
  mainImage,
  author->{
    name,
    image
  },
  categories[]->{
    title
  },
  seoDescription,
  body
}`;

async function fetchArticlesFromSanity(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedArticles && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedArticles;
  }

  const sanityToken = (process.env.SANITY_TOKEN || "").trim();
  const encodedQuery = encodeURIComponent(ARTICLES_GROQ);
  const url = `https://${SANITY_PROJECT_ID}.api.sanity.io/${SANITY_API_VERSION}/data/query/${SANITY_DATASET}?perspective=published&query=${encodedQuery}`;

  const headers = {
    Accept: "application/json",
  };
  if (sanityToken) {
    headers["Authorization"] = `Bearer ${sanityToken}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Sanity API HTTP ${response.status}: ${errText.slice(0, 200)}`);
  }

  const json = await response.json();
  const articles = Array.isArray(json.result) ? json.result : [];

  cachedArticles = articles;
  cacheTimestamp = now;
  return articles;
}

/**
 * GET /api/tracker/news
 * Fetches published Nismara Group articles from Sanity CMS using SANITY_TOKEN Viewer API.
 * Pass ?refresh=1 to bypass the 5-minute in-memory cache.
 */
router.get("/", async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === "1" || req.query.refresh === "true";
    const articles = await fetchArticlesFromSanity(forceRefresh);

    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      count: articles.length,
      articles,
      data: articles,
    });
  } catch (err) {
    console.error("[News API] Error fetching Sanity articles:", err);
    if (cachedArticles && cachedArticles.length > 0) {
      return res.json({
        success: true,
        stale: true,
        timestamp: new Date().toISOString(),
        count: cachedArticles.length,
        articles: cachedArticles,
        data: cachedArticles,
      });
    }
    return res.status(500).json({
      success: false,
      error: "Gagal memuat berita dari Sanity CMS.",
      details: err?.message || String(err),
    });
  }
});

/**
 * GET /api/tracker/news/:slug
 * Fetches a single published article by slug.
 */
router.get("/:slug", async (req, res) => {
  try {
    const targetSlug = String(req.params.slug || "").trim();
    const articles = await fetchArticlesFromSanity(false);
    const found = articles.find((a) => a?.slug?.current === targetSlug);

    if (!found) {
      return res.status(404).json({
        success: false,
        error: "Artikel tidak ditemukan.",
      });
    }

    return res.json({
      success: true,
      article: found,
    });
  } catch (err) {
    console.error("[News API] Error fetching article by slug:", err);
    return res.status(500).json({
      success: false,
      error: "Gagal memuat detail artikel.",
      details: err?.message || String(err),
    });
  }
});

export default router;

