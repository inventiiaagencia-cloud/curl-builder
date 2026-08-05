import { catalog as localCatalog } from "../data/catalog.js";

function normalize(text = "") {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s/_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function searchCatalog(query = "", product = "", items = localCatalog) {
  const q = normalize(query);
  const p = normalize(product);

  const scored = items
    .map((entry) => {
      const haystack = normalize(
        [
          entry.product,
          entry.service,
          entry.method,
          entry.path,
          entry.title,
          entry.description,
          ...(entry.keywords || [])
        ].join(" ")
      );

      let score = 0;
      for (const token of q.split(" ")) {
        if (!token) continue;
        if (haystack.includes(token)) score += token.length >= 4 ? 3 : 1;
      }

      if (p && normalize(entry.product).includes(p)) score += 10;
      if (q.includes(normalize(entry.title))) score += 5;
      if (q.includes(normalize(entry.path))) score += 4;

      return { entry, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored;
}

export function explainMatch(best) {
  if (!best) return null;
  return {
    product: best.product,
    title: best.title,
    method: best.method,
    path: best.path,
    description: best.description,
    authHeader: best.authHeader,
    bodyType: best.bodyType
  };
}
