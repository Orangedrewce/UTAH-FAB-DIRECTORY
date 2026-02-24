const IMAGE_EXT_RE = /\.(png|jpe?g|webp|avif)(\?|#|$)/i;
const GIF_EXT_RE = /\.gif(\?|#|$)/i;
const MODEL_EXT_RE = /\.(glb|gltf|obj|mtl|stl|step|stp|iges|igs)(\?|#|$)/i;

export const MEDIA_LIMITS = {
  maxAssets: 12,
  maxTotalBytes: 100 * 1024 * 1024,
};

function toSafeUrl(value) {
  const url = String(value || "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) return "";
  return url;
}

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

export function toMediaAssetsPayload(assets) {
  if (!Array.isArray(assets) || !assets.length) return [];
  return assets
    .filter((asset) => !!toSafeUrl(asset.url))
    .map((asset, index) => ({
      id: asset.id,
      type: inferAssetType(asset),
      url: toSafeUrl(asset.url),
      alt: String(asset.alt || "").trim() || null,
      size_bytes: Number.isFinite(Number(asset.size_bytes))
        ? Math.max(0, Number(asset.size_bytes))
        : null,
      position: index,
      is_cover: !!asset.is_cover,
    }));
}

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
