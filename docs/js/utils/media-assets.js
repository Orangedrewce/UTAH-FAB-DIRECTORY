// @ts-check

/**
 * ═══════════════════════════════════════════════════════════════════════
 * MODULE: media-assets.js — Media Asset Normalization + Validation Rules
 * ═══════════════════════════════════════════════════════════════════════
 *
 * SCOPE:
 *   This module defines the canonical client-side contract for media
 *   asset objects used by portfolio/admin UI and persistence payloads.
 *   It is pure data-shaping/validation logic (no DOM operations).
 *
 * CANONICAL ASSET SHAPE:
 *   {
 *     id: string,
 *     type: "image" | "gif" | "model",
 *     url: string (http/https only; empty string allowed in drafts),
 *     alt: string,
 *     size_bytes: number|null,
 *     position: number,
 *     is_cover: boolean
 *   }
 *
 * RUNTIME CONTRACT:
 *   1) URL hygiene:
 *      - `toSafeUrl()` trims values and accepts only `http://`/`https://`.
 *      - Non-http(s) or empty inputs normalize to `""`.
 *
 *   2) Type inference (`inferAssetType`):
 *      - Declared `asset.type` wins when valid (`image|gif|model`).
 *      - Otherwise inferred from URL heuristics (GIF/image/model regex,
 *        `3dviewer.net`, or comma-containing model-like URLs).
 *      - Fallback default is `image`.
 *
 *   3) Draft creation (`createAssetDraft`):
 *      - Produces canonical shape with normalized values.
 *      - `id` is preserved or generated (`crypto.randomUUID` fallback).
 *      - `size_bytes` is coerced to non-negative number or `null`.
 *
 *   4) Normalization pipeline (`normaliseMediaAssets`):
 *      - Accepts array or JSON string input for `rawAssets`.
 *      - Invalid JSON degrades to empty list (non-throwing behavior).
 *      - Drops empty-URL assets unless `options.includeEmpty === true`.
 *      - Reindexes positions to dense zero-based ordering.
 *      - If normalized list is empty, attempts legacy fallback from
 *        `legacyImageUrl`/`legacyModelUrl`.
 *      - Guarantees one cover assignment when assets exist by selecting
 *        first visual asset, otherwise first asset.
 *
 *   5) Validation (`validateMediaAssets`):
 *      - Enforces `MEDIA_LIMITS` (`maxAssets`, `maxTotalBytes`).
 *      - Requires valid URL and valid type per asset.
 *      - Requires exactly one cover when asset array is non-empty.
 *      - Returns structured result `{ ok, errors, totalBytes }`.
 *
 *   6) Payload shaping (`toMediaAssetsPayload`):
 *      - Filters out assets without safe URLs.
 *      - Recomputes `type`, trims `alt`, normalizes `size_bytes`, and
 *        rewrites sequential `position` values.
 *
 *   7) Legacy bridge (`mediaAssetsToLegacy`):
 *      - Derives legacy fields (`image_url`, `model_url`, sizes,
 *        `cover_index`) from canonical asset list.
 *      - If cover is a model, selects first visual as legacy image where
 *        available.
 *
 *   8) Visual extraction (`getCardVisualAssets`):
 *      - Returns normalized assets plus split subsets:
 *        `visualAssets` (image/gif) and `modelAssets` (model).
 *
 * OPERATIONAL CAVEATS:
 *   • Validation allows both `http` and `https`, while one user-facing
 *     error string currently says "https URL"; this text is stricter than
 *     actual predicate.
 *   • Type inference is heuristic; uncommon URLs may default to `image`.
 *   • Cover integrity is guaranteed by normalization, but callers can
 *     still build invalid arrays manually; run `validateMediaAssets()`
 *     before persistence.
 *
 * MAINTENANCE CHECKLIST:
 *   • New supported media extension: update regexes and any MIME/consumer
 *     assumptions in related upload code.
 *   • New asset type: update inference, validation allowlist, payload map,
 *     and legacy bridge behavior.
 *   • Limit changes: adjust `MEDIA_LIMITS` and keep UI copy/messages in
 *     sync with enforced values.
 *   • Contract changes: keep normalization and validation aligned so
 *     saved payloads always satisfy downstream expectations.
 * ═══════════════════════════════════════════════════════════════════════
 */

/**
 * @typedef {Object} MediaAsset
 * @property {string}       id
 * @property {"image"|"gif"|"model"} type
 * @property {string}       url        — http(s) URL; empty string in drafts
 * @property {string}       alt
 * @property {number|null}  size_bytes
 * @property {number}       position   — zero-based display order
 * @property {boolean}      is_cover
 */

/**
 * @typedef {Object} ValidationResult
 * @property {boolean}  ok
 * @property {string[]} errors
 * @property {number}   totalBytes
 */

/**
 * @typedef {Object} LegacyMediaFields
 * @property {string|null}  image_url
 * @property {number|null}  image_size_bytes
 * @property {string|null}  model_url
 * @property {number|null}  model_size_bytes
 * @property {number|null}  cover_index
 */

/**
 * @typedef {Object} CardVisualResult
 * @property {MediaAsset[]} assets       — full normalised asset list
 * @property {MediaAsset[]} visualAssets — image + gif subset
 * @property {MediaAsset[]} modelAssets  — model subset
 */

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|avif)(\?|#|$)/i;
const GIF_EXT_RE = /\.gif(\?|#|$)/i;
const MODEL_EXT_RE = /\.(glb|gltf|obj|mtl|stl|step|stp|iges|igs)(\?|#|$)/i;

/** @type {Readonly<{ maxAssets: number, maxTotalBytes: number }>} */
export const MEDIA_LIMITS = {
  maxAssets: 12,
  maxTotalBytes: 100 * 1024 * 1024,
};

/**
 * Trim and validate a URL — returns "" for non-http(s) values.
 * @param {any} value
 * @returns {string}
 */
function toSafeUrl(value) {
  const url = String(value || "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) return "";
  return url;
}

/**
 * Infer asset type from declared type or URL heuristics.
 * @param {{ type?: string, url?: string }} [asset={}]
 * @returns {"image"|"gif"|"model"}
 */
export function inferAssetType(asset = {}) {
  const declared = String(asset.type || "")
    .trim()
    .toLowerCase();
  if (declared === "image" || declared === "gif" || declared === "model")
    return declared;

  const url = String(asset.url || "").trim();
  if (GIF_EXT_RE.test(url)) return "gif";
  if (IMAGE_EXT_RE.test(url)) return "image";
  if (MODEL_EXT_RE.test(url) || /3dviewer\.net/i.test(url) || url.includes(","))
    return "model";
  return "image";
}

/**
 * Create a canonical asset draft from a partial seed.
 * @param {Partial<MediaAsset>} [seed={}]
 * @param {number} [position=0]
 * @returns {MediaAsset}
 */
export function createAssetDraft(seed = {}, position = 0) {
  const url = toSafeUrl(seed.url);
  const type = inferAssetType({ ...seed, url });
  return {
    id: String(
      seed.id || crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    ),
    type,
    url,
    alt: String(seed.alt || "").trim(),
    size_bytes: Number.isFinite(Number(seed.size_bytes))
      ? Math.max(0, Number(seed.size_bytes))
      : null,
    position,
    is_cover: !!seed.is_cover,
  };
}

/**
 * @param {any} rawAssets
 * @param {{ includeEmpty?: boolean }} [options={}]
 * @returns {MediaAsset[]}
 */
function cleanIncomingArray(rawAssets, options = {}) {
  const includeEmpty = !!options.includeEmpty;
  if (!Array.isArray(rawAssets)) return [];
  const cleaned = rawAssets
    .map((raw, index) => createAssetDraft(raw, index))
    .filter((asset) => includeEmpty || !!asset.url);

  cleaned.sort((a, b) => (a.position || 0) - (b.position || 0));
  cleaned.forEach((asset, index) => {
    asset.position = index;
  });
  return cleaned;
}

/**
 * Normalise raw asset data into a clean, cover-guaranteed asset list.
 * Accepts an array, JSON string, or null; falls back to legacy fields.
 * @param {MediaAsset[] | string | null | undefined} rawAssets
 * @param {string} [legacyImageUrl=""]
 * @param {string} [legacyModelUrl=""]
 * @param {{ includeEmpty?: boolean }} [options={}]
 * @returns {MediaAsset[]}
 */
export function normaliseMediaAssets(
  rawAssets,
  legacyImageUrl = "",
  legacyModelUrl = "",
  options = {},
) {
  const includeEmpty = !!options.includeEmpty;
  let parsed = rawAssets;
  if (typeof rawAssets === "string") {
    try {
      parsed = JSON.parse(rawAssets);
    } catch (_) {
      parsed = [];
    }
  }

  let assets = cleanIncomingArray(parsed, { includeEmpty });

  if (!assets.length) {
    const fallback = [];
    const imageUrl = toSafeUrl(legacyImageUrl);
    if (imageUrl) {
      fallback.push(
        createAssetDraft(
          {
            type: inferAssetType({ url: imageUrl }),
            url: imageUrl,
            is_cover: true,
          },
          0,
        ),
      );
    }

    const modelUrl = toSafeUrl(legacyModelUrl);
    if (modelUrl) {
      fallback.push(
        createAssetDraft(
          { type: "model", url: modelUrl, is_cover: fallback.length === 0 },
          fallback.length,
        ),
      );
    }
    assets = fallback;
  }

  if (!assets.length) return [];

  const hasCover = assets.some((asset) => asset.is_cover);
  if (!hasCover) {
    const firstVisual = assets.find(
      (asset) => asset.type === "image" || asset.type === "gif",
    );
    if (firstVisual) firstVisual.is_cover = true;
    else assets[0].is_cover = true;
  }

  return assets.map((asset, index) => ({ ...asset, position: index }));
}

/**
 * Validate an asset array against size/count/cover constraints.
 * @param {MediaAsset[]} assets
 * @param {{ maxAssets: number, maxTotalBytes: number }} [limits=MEDIA_LIMITS]
 * @returns {ValidationResult}
 */
export function validateMediaAssets(assets, limits = MEDIA_LIMITS) {
  const errors = [];
  if (!Array.isArray(assets)) {
    return {
      ok: false,
      errors: ["Media assets must be an array."],
      totalBytes: 0,
    };
  }

  if (assets.length > limits.maxAssets) {
    errors.push(`Maximum ${limits.maxAssets} assets allowed per card.`);
  }

  let totalBytes = 0;
  let coverCount = 0;

  for (let i = 0; i < assets.length; i += 1) {
    const asset = assets[i];
    const indexLabel = `Asset ${i + 1}`;

    if (!toSafeUrl(asset.url))
      errors.push(`${indexLabel}: valid https URL is required.`);
    if (!["image", "gif", "model"].includes(asset.type))
      errors.push(`${indexLabel}: type must be image, gif, or model.`);

    const sizeBytes = Number(asset.size_bytes || 0);
    if (sizeBytes > 0) totalBytes += sizeBytes;

    if (asset.is_cover) coverCount += 1;
  }

  if (assets.length && coverCount !== 1) {
    errors.push("Exactly one cover asset is required when assets exist.");
  }

  if (totalBytes > limits.maxTotalBytes) {
    errors.push("Total asset size exceeds 100MB per card.");
  }

  return { ok: errors.length === 0, errors, totalBytes };
}

/**
 * Shape an asset array into a persistence-ready payload.
 * Filters empty URLs, recomputes types/positions, trims alt text.
 * @param {MediaAsset[]} assets
 * @returns {MediaAsset[]}
 */
export function toMediaAssetsPayload(assets) {
  if (!Array.isArray(assets) || !assets.length) return [];
  return assets
    .filter((asset) => !!toSafeUrl(asset.url))
    .map((asset, index) => ({
      id: asset.id,
      type: inferAssetType(asset),
      url: toSafeUrl(asset.url),
      alt: String(asset.alt || "").trim(),
      size_bytes: Number.isFinite(Number(asset.size_bytes))
        ? Math.max(0, Number(asset.size_bytes))
        : null,
      position: index,
      is_cover: !!asset.is_cover,
    }));
}

/**
 * Derive legacy DB columns from a canonical asset list.
 * @param {MediaAsset[]} assets
 * @returns {LegacyMediaFields}
 */
export function mediaAssetsToLegacy(assets) {
  const list = Array.isArray(assets) ? assets : [];
  if (!list.length) {
    return {
      image_url: null,
      image_size_bytes: null,
      model_url: null,
      model_size_bytes: null,
      cover_index: null,
    };
  }

  const coverIndex = Math.max(
    0,
    list.findIndex((asset) => asset.is_cover),
  );
  const coverAsset = list[coverIndex] || list[0];

  const imageAsset =
    coverAsset.type === "model"
      ? list.find((asset) => asset.type === "image" || asset.type === "gif") ||
        null
      : coverAsset;
  const modelAsset = list.find((asset) => asset.type === "model") || null;

  return {
    image_url: imageAsset?.url || null,
    image_size_bytes: imageAsset?.size_bytes || null,
    model_url: modelAsset?.url || null,
    model_size_bytes: modelAsset?.size_bytes || null,
    cover_index: coverIndex,
  };
}

/**
 * Extract normalised assets plus visual/model subsets for card rendering.
 * @param {{ media_assets?: any, image_url?: string, model_url?: string }} item
 * @returns {CardVisualResult}
 */
export function getCardVisualAssets(item) {
  const assets = normaliseMediaAssets(
    item?.media_assets,
    item?.image_url,
    item?.model_url,
  );
  const visualAssets = assets.filter(
    (asset) => asset.type === "image" || asset.type === "gif",
  );
  const modelAssets = assets.filter((asset) => asset.type === "model");
  return { assets, visualAssets, modelAssets };
}
