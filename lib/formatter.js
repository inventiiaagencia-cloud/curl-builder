function buildHeaders(headers) {
  return Object.entries(headers)
    .map(([key, value]) => `  --header '${key}: ${value}'`)
    .join(" \\\n");
}

function buildJsonBody(body) {
  return body ? `  --data '${body.replaceAll("'", "'\\''")}'` : "";
}

function buildFormBody() {
  return [
    "  --form 'number=5511999999999'",
    "  --form 'mediatype=image'",
    "  --form 'media=@arquivo.jpg'"
  ].join(" \\\n");
}

function placeholderForAuth(entry) {
  if (entry.authHeader === "apikey") return "SUA_API_KEY";
  if (entry.authHeader === "api_access_token") return "SUA_API_KEY";
  return null;
}

export function toCurl(entry) {
  const headersMap = { ...(entry.resolvedHeaders || entry.n8n?.headers || {}) };
  const authValue = placeholderForAuth(entry);
  if (authValue && entry.authHeader) {
    headersMap[entry.authHeader] = authValue;
  }

  const headers = buildHeaders(headersMap);
  const method = entry.method || "GET";
  const url = entry.resolvedUrl || entry.pathExample || entry.n8n?.url;

  let body = "";
  if (entry.bodyType === "json" && entry.curlBody) {
    body = buildJsonBody(entry.curlBody);
  } else if (entry.bodyType === "multipart") {
    body = buildFormBody();
  }

  const lines = [`curl --request ${method} \\`, `  --url ${url}`];

  if (headers) lines.push(headers);
  if (body) lines.push(body);

  return lines.join(" \\\n");
}

export function toN8n(entry) {
  const headers = Object.entries(entry.resolvedHeaders || entry.n8n?.headers || {})
    .map(([key, value]) => `- ${key}: ${value}`)
    .join("\n");

  return [
    `Method: ${entry.n8n?.method || entry.method || "GET"}`,
    `URL: ${entry.n8n?.url || entry.resolvedUrl || entry.pathExample || ""}`,
    `Body mode: ${entry.n8n?.bodyMode || entry.bodyType || "none"}`,
    headers ? `Headers:\n${headers}` : "Headers: none",
    entry.bodyType === "json" && entry.curlBody ? `Body example:\n${entry.curlBody}` : "",
    entry.bodyType === "multipart" ? "Body example: multipart/form-data com arquivo binário" : ""
  ]
    .filter(Boolean)
    .join("\n\n");
}
