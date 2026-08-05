import http from "node:http";
import { URL } from "node:url";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { catalog as seedCatalog, products as seedProducts } from "./data/catalog.js";
import { searchCatalog } from "./lib/matcher.js";
import { toCurl, toN8n } from "./lib/formatter.js";
import {
  createSupabaseEndpoint,
  createSupabaseProfile,
  deleteSupabaseEndpoint,
  getSupabaseConfig,
  loadSupabaseWorkspace,
  updateSupabaseEndpoint,
  updateSupabaseProfile
} from "./lib/supabase.js";

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";

const runtimeProfiles = [];
const runtimeEndpoints = [];

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

function sendHtml(res, html) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function isAbsoluteUrl(value = "") {
  return /^https?:\/\//i.test(String(value).trim());
}

function joinUrl(baseUrl = "", targetPath = "") {
  const base = String(baseUrl || "").trim().replace(/\/$/, "");
  const target = String(targetPath || "").trim();
  if (!base) return target;
  if (!target) return base;
  if (isAbsoluteUrl(target)) return target;
  return `${base}${target.startsWith("/") ? "" : "/"}${target}`;
}

function parseMaybeJson(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function toList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function makeSeedProfile() {
  return {
    id: "seed-local",
    name: "Local",
    baseUrl: "",
    authHeader: "none",
    authValue: "",
    extraHeaders: {},
    notes: "Catálogo local embutido",
    source: "seed"
  };
}

function decorateEndpoint(entry, profile = null, source = "seed") {
  const headers = {
    ...(profile?.extraHeaders || {}),
    ...(entry.n8n?.headers || {})
  };

  const authHeader = entry.authHeader && entry.authHeader !== "none"
    ? entry.authHeader
    : profile?.authHeader || "none";

  if (authHeader !== "none" && profile?.authValue) {
    headers[authHeader] = profile.authValue;
  }

  const resolvedUrl = entry.pathExample || entry.n8n?.url || joinUrl(profile?.baseUrl, entry.path);

  return {
    ...entry,
    profileName: entry.profileName || profile?.name || "Local",
    resolvedUrl,
    resolvedHeaders: headers,
    authHeader,
    source
  };
}

function decorateSeedCatalog() {
  return seedCatalog.map((entry) => decorateEndpoint(entry, makeSeedProfile(), "seed"));
}

function mergeCatalogLists(primary, fallback) {
  const merged = [];
  const seen = new Set();

  for (const item of [...primary, ...fallback]) {
    const key = [
      item.profileName || "",
      item.product || "",
      item.method || "",
      item.path || "",
      item.title || ""
    ].join("|").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }

  return merged;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

async function safeJsonBody(req) {
  try {
    return await readJsonBody(req);
  } catch (error) {
    const err = new Error("JSON invalido no corpo da requisicao");
    err.statusCode = 400;
    err.details = error.message;
    throw err;
  }
}

function normalizeProfilePayload(body = {}) {
  return {
    name: String(body.name || "").trim(),
    baseUrl: String(body.baseUrl || body.base_url || "").trim(),
    authHeader: String(body.authHeader || body.auth_header || "none").trim() || "none",
    authValue: String(body.authValue || body.auth_value || "").trim(),
    extraHeaders: parseMaybeJson(body.extraHeaders || body.extra_headers, {}),
    notes: String(body.notes || "").trim()
  };
}

function normalizeEndpointPayload(body = {}) {
  return {
    profileName: String(body.profileName || body.profile_name || "Local").trim() || "Local",
    product: String(body.product || "").trim(),
    service: String(body.service || "").trim(),
    method: String(body.method || "GET").trim().toUpperCase(),
    path: String(body.path || "").trim(),
    authHeader: String(body.authHeader || body.auth_header || "none").trim() || "none",
    bodyType: String(body.bodyType || body.body_type || "none").trim() || "none",
    title: String(body.title || "").trim(),
    description: String(body.description || "").trim(),
    keywords: toList(body.keywords),
    pathExample: String(body.pathExample || body.path_example || "").trim(),
    curlBody: String(body.curlBody || body.curl_body || "").trim(),
    n8n: {
      method: String(body.n8nMethod || body.n8n_method || body.method || "GET").trim().toUpperCase(),
      url: String(body.n8nUrl || body.n8n_url || "").trim(),
      headers: parseMaybeJson(body.n8nHeaders || body.n8n_headers, {}),
      bodyMode: String(body.n8nBodyMode || body.n8n_body_mode || "none").trim() || "none"
    }
  };
}

async function loadWorkspace() {
  const warnings = [];
  const config = getSupabaseConfig();

  if (!config) {
    return {
      useSupabase: false,
      warnings,
      profiles: [makeSeedProfile(), ...runtimeProfiles],
      endpoints: mergeCatalogLists([...runtimeEndpoints], decorateSeedCatalog()),
      source: "local"
    };
  }

  try {
    const workspace = await loadSupabaseWorkspace();
    if (!workspace) throw new Error("Supabase nao configurado");

    const profiles = [makeSeedProfile(), ...workspace.profiles.map((profile) => ({
      ...profile,
      source: "supabase"
    }))];
    const profileMap = new Map(profiles.map((profile) => [String(profile.name).toLowerCase(), profile]));
    const supabaseEndpoints = workspace.endpoints.map((entry) => {
      const profile = profileMap.get(String(entry.profileName || "Local").toLowerCase()) || null;
      return decorateEndpoint(entry, profile, "supabase");
    });

    return {
      useSupabase: true,
      warnings,
      profiles,
      endpoints: mergeCatalogLists(supabaseEndpoints, decorateSeedCatalog()),
      source: "supabase"
    };
  } catch (error) {
    warnings.push("Supabase indisponivel: " + error.message);
    return {
      useSupabase: false,
      warnings,
      profiles: [makeSeedProfile(), ...runtimeProfiles],
      endpoints: mergeCatalogLists([...runtimeEndpoints], decorateSeedCatalog()),
      source: "local"
    };
  }
}

function findProfileByName(state, name) {
  const normalized = String(name || "").trim().toLowerCase();
  return state.profiles.find((profile) => String(profile.name || "").trim().toLowerCase() === normalized) || null;
}

function splitCurlTokens(input = "") {
  const normalized = String(input).replace(/\r/g, "").replace(/\\\n/g, " ");
  const tokens = [];
  let current = "";
  let quote = null;
  let escaped = false;

  for (const char of normalized) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) tokens.push(current);
  return tokens;
}

function parseCurlCommand(input = "") {
  const tokens = splitCurlTokens(input).filter(Boolean);
  if (!tokens.length) throw new Error("Cole um comando curl valido");
  if (tokens[0].toLowerCase() === "curl") tokens.shift();

  const result = { method: "GET", url: "", headers: {}, body: null, formData: [] };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1];

    if (token === "-X" || token === "--request") {
      result.method = String(next || "GET").toUpperCase();
      index += 1;
      continue;
    }

    if (token === "--url") {
      result.url = String(next || "");
      index += 1;
      continue;
    }

    if (token === "-H" || token === "--header") {
      const header = String(next || "");
      const separator = header.indexOf(":");
      if (separator !== -1) {
        const key = header.slice(0, separator).trim();
        const value = header.slice(separator + 1).trim();
        if (key) result.headers[key] = value;
      }
      index += 1;
      continue;
    }

    if (token === "--data" || token === "--data-raw" || token === "--data-binary") {
      result.body = String(next || "");
      if (result.method === "GET") result.method = "POST";
      index += 1;
      continue;
    }

    if (token === "-F" || token === "--form") {
      const form = String(next || "");
      const separator = form.indexOf("=");
      if (separator === -1) {
        result.formData.push({ name: form, value: "" });
      } else {
        result.formData.push({
          name: form.slice(0, separator).trim(),
          value: form.slice(separator + 1)
        });
      }
      if (result.method === "GET") result.method = "POST";
      index += 1;
      continue;
    }

    if (!token.startsWith("-") && !result.url) {
      result.url = token;
    }
  }

  if (!result.url) throw new Error("Nao encontrei a URL no curl");
  return result;
}

async function buildRequestFromCurl(curlText) {
  const parsed = parseCurlCommand(curlText);
  const requestInit = { method: parsed.method || "GET", headers: { ...parsed.headers } };

  if (parsed.formData.length > 0) {
    const formData = new FormData();
    for (const item of parsed.formData) {
      if (item.value.startsWith("@")) {
        const filePath = item.value.slice(1);
        const buffer = await readFile(filePath);
        formData.append(item.name, new Blob([buffer]), path.basename(filePath));
      } else {
        formData.append(item.name, item.value);
      }
    }
    requestInit.body = formData;
    delete requestInit.headers["Content-Type"];
    delete requestInit.headers["content-type"];
    return { url: parsed.url, requestInit };
  }

  if (parsed.body != null) {
    requestInit.body = parsed.body;
  }

  return { url: parsed.url, requestInit };
}

async function executeCurl(curlText) {
  const { url, requestInit } = await buildRequestFromCurl(curlText);
  const response = await fetch(url, requestInit);
  const responseText = await response.text();
  return {
    ok: response.ok,
    request: { method: requestInit.method, url, headers: requestInit.headers },
    response: {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body: responseText.slice(0, 20000)
    }
  };
}

async function saveProfile(payload) {
  const state = await loadWorkspace();
  const profile = normalizeProfilePayload(payload);
  const existingId = payload.id || payload.profileId;

  if (!profile.name) {
    const error = new Error("Informe o nome do perfil");
    error.statusCode = 400;
    throw error;
  }

  const duplicate = state.profiles.find((item) => String(item.name).trim().toLowerCase() === profile.name.trim().toLowerCase());
  if (duplicate && String(duplicate.id) !== String(existingId || "")) {
    const error = new Error("Ja existe um perfil com esse nome");
    error.statusCode = 409;
    throw error;
  }

  if (existingId) {
    if (state.useSupabase) {
      return updateSupabaseProfile(existingId, {
        name: profile.name,
        base_url: profile.baseUrl,
        auth_header: profile.authHeader,
        auth_value: profile.authValue,
        extra_headers: profile.extraHeaders,
        notes: profile.notes
      });
    }

    const target = runtimeProfiles.find((item) => String(item.id) === String(existingId));
    if (!target) {
      const error = new Error("Perfil nao encontrado");
      error.statusCode = 404;
      throw error;
    }
    Object.assign(target, profile);
    return target;
  }

  if (state.useSupabase) {
    return createSupabaseProfile({
      name: profile.name,
      base_url: profile.baseUrl,
      auth_header: profile.authHeader,
      auth_value: profile.authValue,
      extra_headers: profile.extraHeaders,
      notes: profile.notes
    });
  }

  const created = { id: "runtime-profile-" + Date.now(), ...profile };
  runtimeProfiles.push(created);
  return created;
}

async function saveEndpoint(payload) {
  const state = await loadWorkspace();
  const endpoint = normalizeEndpointPayload(payload);
  const existingId = payload.id || payload.endpointId;
  const profile = findProfileByName(state, endpoint.profileName);

  if (!endpoint.title || !endpoint.product || !endpoint.method || !endpoint.path) {
    const error = new Error("Preencha produto, titulo, metodo e path");
    error.statusCode = 400;
    throw error;
  }

  if (endpoint.profileName !== "Local" && !profile) {
    const error = new Error("Perfil selecionado nao existe");
    error.statusCode = 400;
    throw error;
  }

  const resolved = decorateEndpoint(
    {
      ...endpoint,
      pathExample: endpoint.pathExample || joinUrl(profile?.baseUrl, endpoint.path),
      n8n: {
        ...endpoint.n8n,
        url: endpoint.n8n.url || joinUrl(profile?.baseUrl, endpoint.path)
      }
    },
    profile,
    state.useSupabase ? "supabase" : "local"
  );

  if (existingId) {
    if (state.useSupabase) {
      const updated = await updateSupabaseEndpoint(existingId, {
        profile_name: endpoint.profileName,
        product: endpoint.product,
        service: endpoint.service,
        method: endpoint.method,
        path: endpoint.path,
        auth_header: endpoint.authHeader,
        body_type: endpoint.bodyType,
        title: endpoint.title,
        description: endpoint.description,
        keywords: endpoint.keywords,
        path_example: resolved.resolvedUrl,
        curl_body: endpoint.curlBody,
        n8n_method: endpoint.n8n.method,
        n8n_url: resolved.resolvedUrl,
        n8n_headers: resolved.resolvedHeaders,
        n8n_body_mode: endpoint.n8n.bodyMode
      });
      return updated ? decorateEndpoint(updated, profile, "supabase") : resolved;
    }

    const target = runtimeEndpoints.find((item) => String(item.id) === String(existingId));
    if (!target) {
      const error = new Error("Endpoint nao encontrado");
      error.statusCode = 404;
      throw error;
    }
    Object.assign(target, resolved, { id: existingId });
    return target;
  }

  if (state.useSupabase) {
    const created = await createSupabaseEndpoint({
      profile_name: endpoint.profileName,
      product: endpoint.product,
      service: endpoint.service,
      method: endpoint.method,
      path: endpoint.path,
      auth_header: endpoint.authHeader,
      body_type: endpoint.bodyType,
      title: endpoint.title,
      description: endpoint.description,
      keywords: endpoint.keywords,
      path_example: resolved.resolvedUrl,
      curl_body: endpoint.curlBody,
      n8n_method: endpoint.n8n.method,
      n8n_url: resolved.resolvedUrl,
      n8n_headers: resolved.resolvedHeaders,
      n8n_body_mode: endpoint.n8n.bodyMode
    });
    return decorateEndpoint(created, profile, "supabase");
  }

  const created = { id: "runtime-endpoint-" + Date.now(), ...resolved };
  runtimeEndpoints.push(created);
  return created;
}

async function getBootstrap() {
  const state = await loadWorkspace();
  const catalogList = state.endpoints;
  const profileNames = state.profiles.map((item) => item.name).filter(Boolean);
  const productNames = [...new Set(catalogList.map((item) => item.product).filter(Boolean))];

  return {
    ok: true,
    source: state.source,
    warnings: state.warnings,
    counts: {
      profiles: state.profiles.length,
      endpoints: catalogList.length,
      products: productNames.length
    },
    seedProducts,
    products: productNames,
    profiles: state.profiles,
    catalog: catalogList,
    profileNames,
    supabaseConfigured: Boolean(getSupabaseConfig())
  };
}

async function searchHandler(body) {
  const question = String(body?.question || "").trim();
  const product = String(body?.product || "").trim();
  if (!question) {
    const error = new Error("Digite uma pergunta para buscar o endpoint");
    error.statusCode = 400;
    throw error;
  }

  const state = await loadWorkspace();
  const ranked = searchCatalog(question, product === "Todos" ? "" : product, state.endpoints);
  const best = ranked[0]?.entry;

  if (!best) {
    return {
      ok: true,
      match: null,
      message: "Nenhum endpoint encontrado. Tente usar nome da acao, produto ou path.",
      suggestions: state.endpoints.slice(0, 8).map((item) => item.title),
      diagnostics: {
        question,
        product,
        endpoints: state.endpoints.length,
        profiles: state.profiles.length,
        warnings: state.warnings
      }
    };
  }

  return {
    ok: true,
    match: best,
    score: ranked[0].score,
    curl: toCurl(best),
    n8n: toN8n(best),
    notes: [
      `Perfil: ${best.profileName || "Local"}`,
      `Produto: ${best.product}`,
      `Auth: ${best.authHeader}`,
      `Body: ${best.bodyType}`,
      `URL: ${best.resolvedUrl || best.pathExample || ""}`
    ].join("\n"),
    diagnostics: {
      question,
      product,
      endpoints: state.endpoints.length,
      profiles: state.profiles.length,
      warnings: state.warnings
    }
  };
}

function pageTemplate() {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Assistente HTTP Request</title>
  <style>
    :root {
      --bg:#07111f; --panel:rgba(13,22,40,.92); --line:rgba(255,255,255,.08);
      --text:#e7eefc; --muted:#8b98b3; --accent:#7dd3fc; --shadow:0 24px 80px rgba(0,0,0,.45);
      --radius:22px;
    }
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--text);background:linear-gradient(180deg,#04101c 0%,var(--bg) 100%)}
    .wrap{max-width:1500px;margin:0 auto;padding:24px}
    .hero,.content-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:20px}
    .card{background:linear-gradient(180deg,var(--panel),rgba(8,15,28,.94));border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);backdrop-filter:blur(12px)}
    .brand,.overview,.section{padding:22px}
    .section{margin-top:20px}
    .kicker{color:var(--accent);text-transform:uppercase;letter-spacing:.18em;font-size:12px;margin-bottom:12px}
    h1{font-size:clamp(34px,5vw,58px);line-height:.96;margin:0 0 14px;max-width:15ch}
    .lead{color:var(--muted);font-size:16px;line-height:1.6;margin:0}
    .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:22px}
    .stat,.notice,.item,.endpoint,.pill{background:rgba(255,255,255,.03);border:1px solid var(--line);border-radius:16px}
    .stat{padding:14px 16px}
    .stat strong{display:block;font-size:18px;margin-bottom:4px}
    .stat span,.muted,.endpoint .meta,.item .meta{color:var(--muted);font-size:13px}
    .badge{display:inline-flex;align-items:center;gap:8px;padding:8px 10px;border-radius:999px;background:rgba(255,255,255,.05);border:1px solid var(--line);width:fit-content}
    .row{display:flex;gap:10px;flex-wrap:wrap}
    .pill-row,.list{display:flex;flex-wrap:wrap;gap:8px}
    .list{display:grid;max-height:300px;overflow:auto;padding-right:2px}
    .pill{display:inline-flex;align-items:center;gap:8px;padding:8px 10px;font-size:13px}
    .pill.active{background:linear-gradient(135deg,rgba(125,211,252,.28),rgba(56,189,248,.2));border-color:rgba(125,211,252,.45)}
    .tabs{display:flex;gap:10px;flex-wrap:wrap;margin:20px 0}
    .tab-btn,.ghost,.primary,select,input,textarea,button{font:inherit;border-radius:14px;border:1px solid var(--line);background:rgba(255,255,255,.04);color:var(--text);padding:12px 14px;outline:none}
    .tab-btn.active,.primary{background:linear-gradient(135deg,var(--accent),#38bdf8);color:#06111f;border-color:transparent;font-weight:700}
    .ghost{background:rgba(255,255,255,.05)}
    .content-grid{grid-template-columns:360px 1fr;align-items:start}
    .sidebar,.workspace{padding:18px;min-height:520px}
    .workspace{display:grid;gap:18px}
    .workspace > section{padding:18px;border:1px solid rgba(255,255,255,.06);border-radius:18px;background:rgba(255,255,255,.02)}
    .section-title{margin:0 0 12px;font-size:13px;text-transform:uppercase;letter-spacing:.14em;color:var(--muted)}
    .stack{display:grid;gap:12px}
    textarea{min-height:120px;resize:vertical}
    pre{white-space:pre-wrap;word-break:break-word;margin:0;background:rgba(0,0,0,.28);border-radius:16px;border:1px solid var(--line);padding:16px;overflow:auto;min-height:90px}
    .label-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;color:var(--muted);font-size:13px;gap:12px}
    .error{border-color:rgba(248,113,113,.35);background:rgba(248,113,113,.08)}
    .success{border-color:rgba(52,211,153,.35);background:rgba(52,211,153,.08)}
    .form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
    .full{grid-column:1 / -1}
    .endpoint-item,.profile-item{padding:12px;border:1px solid var(--line);border-radius:16px;cursor:pointer;background:rgba(255,255,255,.03)}
    .endpoint-item:hover,.profile-item:hover{border-color:rgba(125,211,252,.45)}
    @media (max-width:1060px){.hero,.content-grid{grid-template-columns:1fr}}
    @media (max-width:720px){.stats,.form-grid{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <div class="card brand">
        <div class="kicker">Assistente HTTP Request</div>
        <h1>Catálogo visível, cadastro visível, teste visível.</h1>
        <p class="lead">Busque endpoints, gere curl, teste requisições e salve perfis com URL/base e chaves para não redigitar nada toda vez.</p>
        <div class="stats">
          <div class="stat"><strong id="countEndpoints">0</strong><span>endpoints disponíveis</span></div>
          <div class="stat"><strong id="countProfiles">0</strong><span>perfis salvos</span></div>
          <div class="stat"><strong id="countWarnings">0</strong><span>alertas de ambiente</span></div>
        </div>
      </div>
      <div class="card overview">
        <div class="badge" id="sourceBadge">Carregando...</div>
        <div class="notice" id="warningBox">O sistema usa Supabase quando configurado. Se não, roda em memória nesta sessão.</div>
        <div class="section-title">Produtos</div>
        <div class="pill-row" id="productButtons"></div>
        <div class="section-title">Perfis</div>
        <div class="pill-row" id="profilePills"></div>
      </div>
    </section>

    <div class="tabs">
      <button class="tab-btn active" data-scroll="searchSection">Busca</button>
      <button class="tab-btn" data-scroll="testSection">Teste de curl</button>
      <button class="tab-btn" data-scroll="manageSection">Cadastro</button>
    </div>

    <div class="content-grid">
      <aside class="card sidebar">
        <div class="section-title">Perfis</div>
        <div class="list" id="profilesList"></div>
        <div class="section-title" style="margin-top:16px;">Endpoints</div>
        <div class="list" id="endpointsList"></div>
      </aside>

      <main class="card workspace">
        <section id="searchSection">
          <div class="section-title">Busca funcional</div>
          <form id="searchForm" class="stack">
            <textarea id="searchQuestion" placeholder="Ex.: criar contato no Evo CRM usando api_access_token"></textarea>
            <div class="row">
              <select id="searchProduct"><option value="">Todos os produtos</option></select>
              <button class="primary" type="submit">Buscar</button>
              <button class="ghost" type="button" id="useSearchCurl">Enviar curl ao teste</button>
            </div>
          </form>
          <div class="stack" style="margin-top:18px;">
            <div>
              <div class="label-row"><span>Resposta</span><span id="searchScore"></span></div>
              <div id="searchAnswer" class="notice">Digite uma pergunta para localizar um endpoint.</div>
            </div>
            <div>
              <div class="label-row"><span>curl gerado</span><span id="searchCurlLabel"></span></div>
              <pre id="searchCurl">-</pre>
            </div>
            <div>
              <div class="label-row"><span>HTTP Request no n8n</span><span id="searchN8nLabel"></span></div>
              <pre id="searchN8n">-</pre>
            </div>
            <div>
              <div class="label-row"><span>Diagnóstico</span><span id="searchDiagLabel"></span></div>
              <pre id="searchDiag">-</pre>
            </div>
          </div>
        </section>

        <section id="testSection">
          <div class="section-title">Teste de curl</div>
          <form id="testForm" class="stack">
            <textarea id="curlInput" placeholder="Cole aqui o curl completo para testar"></textarea>
            <div class="row">
              <select id="testProfile"><option value="">Perfil para teste</option></select>
              <button class="primary" type="submit">Executar teste</button>
            </div>
          </form>
          <div class="stack" style="margin-top:18px;">
            <div>
              <div class="label-row"><span>Status</span><span id="testStatusLabel"></span></div>
              <div id="testStatus" class="notice">Nenhum teste executado ainda.</div>
            </div>
            <div>
              <div class="label-row"><span>Resposta</span><span id="testResponseLabel"></span></div>
              <pre id="testResponse">-</pre>
            </div>
            <div>
              <div class="label-row"><span>Detalhes da requisição</span><span id="testRequestLabel"></span></div>
              <pre id="testRequest">-</pre>
            </div>
          </div>
        </section>

        <section id="manageSection">
          <div class="section-title">Cadastro de perfil</div>
          <form id="profileForm" class="stack">
            <input type="hidden" id="profileId" />
            <div class="form-grid">
              <input id="profileName" class="full" type="text" placeholder="Nome do perfil" />
              <input id="profileBaseUrl" class="full" type="text" placeholder="Base URL ex: https://api.exemplo.com" />
              <input id="profileAuthHeader" type="text" placeholder="Header de auth ex: apikey" />
              <input id="profileAuthValue" type="text" placeholder="Chave/token de auth" />
              <textarea id="profileExtraHeaders" class="full" placeholder='Headers extras em JSON ex: {"Content-Type":"application/json"}'></textarea>
              <textarea id="profileNotes" class="full" placeholder="Observações"></textarea>
            </div>
            <div class="row">
              <button class="primary" type="submit">Salvar perfil</button>
              <button class="ghost" type="button" id="clearProfileForm">Limpar</button>
            </div>
          </form>

          <div class="section-title" style="margin-top:20px;">Cadastro de endpoint</div>
          <form id="endpointForm" class="stack">
            <input type="hidden" id="endpointId" />
            <div class="form-grid">
              <select id="endpointProfile" class="full"><option value="">Perfil do endpoint</option></select>
              <input id="endpointProduct" type="text" placeholder="Produto" />
              <input id="endpointService" type="text" placeholder="Serviço" />
              <input id="endpointMethod" type="text" placeholder="Método ex: POST" />
              <input id="endpointPath" type="text" placeholder="Path ex: /api/v1/contacts" />
              <input id="endpointTitle" class="full" type="text" placeholder="Título" />
              <textarea id="endpointDescription" class="full" placeholder="Descrição"></textarea>
              <textarea id="endpointKeywords" class="full" placeholder="Palavras-chave separadas por vírgula"></textarea>
              <select id="endpointBodyType">
                <option value="none">Nenhum body</option>
                <option value="json">JSON</option>
                <option value="multipart">Multipart</option>
              </select>
              <input id="endpointAuthHeader" type="text" placeholder="Auth header override" />
              <input id="endpointPathExample" type="text" placeholder="URL completa opcional" />
              <textarea id="endpointCurlBody" class="full" placeholder="Body de exemplo"></textarea>
              <input id="endpointN8nMethod" type="text" placeholder="n8n method" />
              <input id="endpointN8nUrl" type="text" placeholder="n8n url" />
              <textarea id="endpointN8nHeaders" class="full" placeholder='n8n headers em JSON'></textarea>
              <input id="endpointN8nBodyMode" type="text" placeholder="n8n body mode" />
            </div>
            <div class="row">
              <button class="primary" type="submit">Salvar endpoint</button>
              <button class="ghost" type="button" id="clearEndpointForm">Limpar</button>
            </div>
          </form>
          <div class="stack" style="margin-top:18px;">
            <div>
              <div class="label-row"><span>Resultado do cadastro</span><span id="manageStatusLabel"></span></div>
              <div id="manageStatus" class="notice">Preencha e salve um perfil para reutilizar a URL e a chave.</div>
            </div>
          </div>
        </section>
      </main>
    </div>
  </div>

  <script>
    const state = { bootstrap: null, lastSearch: null };
    const els = {
      sourceBadge: document.getElementById("sourceBadge"),
      warningBox: document.getElementById("warningBox"),
      countEndpoints: document.getElementById("countEndpoints"),
      countProfiles: document.getElementById("countProfiles"),
      countWarnings: document.getElementById("countWarnings"),
      profilePills: document.getElementById("profilePills"),
      productButtons: document.getElementById("productButtons"),
      profilesList: document.getElementById("profilesList"),
      endpointsList: document.getElementById("endpointsList"),
      searchForm: document.getElementById("searchForm"),
      searchQuestion: document.getElementById("searchQuestion"),
      searchProduct: document.getElementById("searchProduct"),
      searchAnswer: document.getElementById("searchAnswer"),
      searchScore: document.getElementById("searchScore"),
      searchCurl: document.getElementById("searchCurl"),
      searchCurlLabel: document.getElementById("searchCurlLabel"),
      searchN8n: document.getElementById("searchN8n"),
      searchN8nLabel: document.getElementById("searchN8nLabel"),
      searchDiag: document.getElementById("searchDiag"),
      searchDiagLabel: document.getElementById("searchDiagLabel"),
      useSearchCurl: document.getElementById("useSearchCurl"),
      testForm: document.getElementById("testForm"),
      curlInput: document.getElementById("curlInput"),
      testProfile: document.getElementById("testProfile"),
      testStatus: document.getElementById("testStatus"),
      testStatusLabel: document.getElementById("testStatusLabel"),
      testResponse: document.getElementById("testResponse"),
      testRequest: document.getElementById("testRequest"),
      testResponseLabel: document.getElementById("testResponseLabel"),
      testRequestLabel: document.getElementById("testRequestLabel"),
      profileForm: document.getElementById("profileForm"),
      profileId: document.getElementById("profileId"),
      profileName: document.getElementById("profileName"),
      profileBaseUrl: document.getElementById("profileBaseUrl"),
      profileAuthHeader: document.getElementById("profileAuthHeader"),
      profileAuthValue: document.getElementById("profileAuthValue"),
      profileExtraHeaders: document.getElementById("profileExtraHeaders"),
      profileNotes: document.getElementById("profileNotes"),
      clearProfileForm: document.getElementById("clearProfileForm"),
      endpointForm: document.getElementById("endpointForm"),
      endpointId: document.getElementById("endpointId"),
      endpointProfile: document.getElementById("endpointProfile"),
      endpointProduct: document.getElementById("endpointProduct"),
      endpointService: document.getElementById("endpointService"),
      endpointMethod: document.getElementById("endpointMethod"),
      endpointPath: document.getElementById("endpointPath"),
      endpointTitle: document.getElementById("endpointTitle"),
      endpointDescription: document.getElementById("endpointDescription"),
      endpointKeywords: document.getElementById("endpointKeywords"),
      endpointBodyType: document.getElementById("endpointBodyType"),
      endpointAuthHeader: document.getElementById("endpointAuthHeader"),
      endpointPathExample: document.getElementById("endpointPathExample"),
      endpointCurlBody: document.getElementById("endpointCurlBody"),
      endpointN8nMethod: document.getElementById("endpointN8nMethod"),
      endpointN8nUrl: document.getElementById("endpointN8nUrl"),
      endpointN8nHeaders: document.getElementById("endpointN8nHeaders"),
      endpointN8nBodyMode: document.getElementById("endpointN8nBodyMode"),
      clearEndpointForm: document.getElementById("clearEndpointForm"),
      manageStatus: document.getElementById("manageStatus"),
      manageStatusLabel: document.getElementById("manageStatusLabel")
    };

    function setStatus(target, text, kind) {
      target.classList.remove("error", "success");
      if (kind === "error") target.classList.add("error");
      if (kind === "success") target.classList.add("success");
      target.textContent = text;
    }

    function fillSelect(select, items, placeholder) {
      const current = select.value;
      select.innerHTML = "";
      const first = document.createElement("option");
      first.value = "";
      first.textContent = placeholder;
      select.appendChild(first);
      items.forEach(function (item) {
        const option = document.createElement("option");
        option.value = item;
        option.textContent = item;
        select.appendChild(option);
      });
      if ([].slice.call(select.options).some(function (option) { return option.value === current; })) {
        select.value = current;
      }
    }

    function syncProductButtons(activeProduct) {
      document.querySelectorAll("[data-product-filter]").forEach(function (button) {
        const value = button.getAttribute("data-product-filter");
        button.classList.toggle("active", String(value || "") === String(activeProduct || ""));
      });
    }

    function renderBootstrap(data) {
      state.bootstrap = data;
      els.sourceBadge.textContent = data.supabaseConfigured ? "Supabase ativo" : "Modo local";
      els.countEndpoints.textContent = data.counts?.endpoints || 0;
      els.countProfiles.textContent = data.counts?.profiles || 0;
      els.countWarnings.textContent = data.warnings ? data.warnings.length : 0;

      if (data.warnings && data.warnings.length) {
        setStatus(els.warningBox, data.warnings.join(" | "), "error");
      } else {
        setStatus(els.warningBox, data.supabaseConfigured ? "Supabase conectado. Os cadastros vao persistir la." : "Sem Supabase. Os cadastros ficam so nesta sessao.", "success");
      }

      const profileNames = (data.profiles || []).map(function (item) { return item.name; }).filter(Boolean);
      const productNames = Array.from(new Set((data.catalog || []).map(function (item) { return item.product; }).filter(Boolean)));

      els.productButtons.innerHTML = [
        '<button class="pill active" type="button" data-product-filter="">Todos</button>'
      ].concat(productNames.map(function (name) {
        return '<button class="pill" type="button" data-product-filter="' + name + '">' + name + "</button>";
      })).join("");

      els.profilePills.innerHTML = profileNames.map(function (name) {
        return '<span class="pill">' + name + "</span>";
      }).join("");

      els.profilesList.innerHTML = (data.profiles || []).map(function (profile) {
        return '<div class="profile-item" data-profile-id="' + (profile.id || "") + '">' +
          "<strong>" + (profile.name || "Perfil") + "</strong>" +
          '<div class="meta">' + (profile.baseUrl || "sem base URL") + "<br>" + (profile.authHeader || "none") + "</div>" +
          "</div>";
      }).join("");

      els.endpointsList.innerHTML = (data.catalog || []).map(function (item) {
        return '<div class="endpoint-item" data-endpoint-id="' + (item.id || "") + '">' +
          "<strong>" + (item.title || "Endpoint") + "</strong>" +
          '<div class="meta">' + (item.profileName || "Local") + " · " + (item.method || "GET") + " " + (item.path || "") + "</div>" +
          "</div>";
      }).join("");

      fillSelect(els.searchProduct, ["Todos"].concat(productNames), "Todos os produtos");
      fillSelect(els.testProfile, profileNames, "Perfil para teste");
      fillSelect(els.endpointProfile, profileNames, "Perfil do endpoint");

      if (!els.endpointProfile.value && profileNames.length) els.endpointProfile.value = profileNames[0];
      if (!els.testProfile.value && profileNames.length) els.testProfile.value = profileNames[0];
      syncProductButtons(els.searchProduct.value);
    }

    async function refreshBootstrap() {
      const response = await fetch("/api/bootstrap");
      renderBootstrap(await response.json());
    }

    function scrollToSection(id) {
      const target = document.getElementById(id);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    async function postJson(url, body) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      return response.json();
    }

    function populateSearchResult(data) {
      state.lastSearch = data;
      if (!data.match) {
        els.searchAnswer.textContent = data.message || "Nenhum resultado.";
        els.searchScore.textContent = "";
        els.searchCurl.textContent = "-";
        els.searchN8n.textContent = "-";
        els.searchDiag.textContent = JSON.stringify(data.diagnostics || {}, null, 2);
        els.searchDiagLabel.textContent = "sem match";
        return;
      }

      els.searchAnswer.innerHTML = "<strong>" + data.match.title + "</strong><br>" + data.match.product + " · " + (data.match.description || "");
      els.searchScore.textContent = "score " + (data.score || 0);
      els.searchCurl.textContent = data.curl || "-";
      els.searchN8n.textContent = data.n8n || "-";
      els.searchDiag.textContent = [
        "Perfil: " + (data.match.profileName || "Local"),
        "URL: " + (data.match.resolvedUrl || data.match.pathExample || ""),
        "Auth: " + (data.match.authHeader || "none"),
        "Body: " + (data.match.bodyType || "none"),
        "Warnings: " + ((data.diagnostics && data.diagnostics.warnings && data.diagnostics.warnings.join(" | ")) || "nenhum")
      ].join("\n");
      els.searchCurlLabel.textContent = (data.match.method || "") + " " + (data.match.path || "");
      els.searchN8nLabel.textContent = data.match.profileName || "";
      els.searchDiagLabel.textContent = data.match.source || "seed";
      els.curlInput.value = data.curl || "";
    }

    els.searchForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      populateSearchResult(await postJson("/api/search", {
        question: els.searchQuestion.value,
        product: els.searchProduct.value
      }));
    });

    els.useSearchCurl.addEventListener("click", function () {
      if (state.lastSearch && state.lastSearch.curl) {
        els.curlInput.value = state.lastSearch.curl;
        scrollToSection("testSection");
      }
    });

    els.testForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      const curl = els.curlInput.value.trim();
      if (!curl) {
        setStatus(els.testStatus, "Cole um curl antes de testar.", "error");
        return;
      }
      setStatus(els.testStatus, "Executando requisicao...", "info");
      els.testResponse.textContent = "-";
      els.testRequest.textContent = "-";
      const data = await postJson("/api/test-curl", { curl: curl, profileName: els.testProfile.value });
      if (data.error) {
        setStatus(els.testStatus, data.error, "error");
        els.testStatusLabel.textContent = "erro";
        return;
      }
      setStatus(els.testStatus, data.response && data.response.status ? "HTTP " + data.response.status : "teste executado", data.ok ? "success" : "error");
      els.testStatusLabel.textContent = data.ok ? "ok" : "falhou";
      els.testRequest.textContent = JSON.stringify(data.request || {}, null, 2);
      els.testResponse.textContent = JSON.stringify(data.response || {}, null, 2);
      els.testResponseLabel.textContent = data.response && data.response.status ? String(data.response.status) + " " + (data.response.statusText || "") : "";
      els.testRequestLabel.textContent = data.request && data.request.method ? data.request.method : "";
    });

    els.profileForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      const payload = {
        id: els.profileId.value || undefined,
        name: els.profileName.value,
        baseUrl: els.profileBaseUrl.value,
        authHeader: els.profileAuthHeader.value,
        authValue: els.profileAuthValue.value,
        extraHeaders: els.profileExtraHeaders.value,
        notes: els.profileNotes.value
      };
      const data = await postJson(els.profileId.value ? "/api/profiles/" + els.profileId.value : "/api/profiles", payload);
      if (data.error) {
        setStatus(els.manageStatus, data.error, "error");
        els.manageStatusLabel.textContent = "erro";
        return;
      }
      setStatus(els.manageStatus, "Perfil salvo: " + (data.name || payload.name), "success");
      els.manageStatusLabel.textContent = "perfil";
      await refreshBootstrap();
      els.profileForm.reset();
      els.profileId.value = "";
    });

    els.endpointForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      const payload = {
        id: els.endpointId.value || undefined,
        profileName: els.endpointProfile.value,
        product: els.endpointProduct.value,
        service: els.endpointService.value,
        method: els.endpointMethod.value,
        path: els.endpointPath.value,
        title: els.endpointTitle.value,
        description: els.endpointDescription.value,
        keywords: els.endpointKeywords.value,
        bodyType: els.endpointBodyType.value,
        authHeader: els.endpointAuthHeader.value,
        pathExample: els.endpointPathExample.value,
        curlBody: els.endpointCurlBody.value,
        n8nMethod: els.endpointN8nMethod.value,
        n8nUrl: els.endpointN8nUrl.value,
        n8nHeaders: els.endpointN8nHeaders.value,
        n8nBodyMode: els.endpointN8nBodyMode.value
      };
      const data = await postJson(els.endpointId.value ? "/api/endpoints/" + els.endpointId.value : "/api/endpoints", payload);
      if (data.error) {
        setStatus(els.manageStatus, data.error, "error");
        els.manageStatusLabel.textContent = "erro";
        return;
      }
      setStatus(els.manageStatus, "Endpoint salvo: " + (data.title || payload.title), "success");
      els.manageStatusLabel.textContent = "endpoint";
      await refreshBootstrap();
      els.endpointForm.reset();
      els.endpointId.value = "";
    });

    els.clearProfileForm.addEventListener("click", function () {
      els.profileForm.reset();
      els.profileId.value = "";
    });

    els.clearEndpointForm.addEventListener("click", function () {
      els.endpointForm.reset();
      els.endpointId.value = "";
    });

    els.searchProduct.addEventListener("change", function () {
      syncProductButtons(els.searchProduct.value);
    });

    document.addEventListener("click", function (event) {
      const productButton = event.target.closest("[data-product-filter]");
      if (productButton) {
        const value = productButton.getAttribute("data-product-filter") || "";
        els.searchProduct.value = value;
        syncProductButtons(value);
        return;
      }

      const profileItem = event.target.closest("[data-profile-id]");
      if (profileItem) {
        const id = profileItem.dataset.profileId;
        const profile = state.bootstrap && state.bootstrap.profiles ? state.bootstrap.profiles.find(function (item) {
          return String(item.id) === String(id);
        }) : null;
        if (profile) {
          els.profileId.value = profile.id || "";
          els.profileName.value = profile.name || "";
          els.profileBaseUrl.value = profile.baseUrl || "";
          els.profileAuthHeader.value = profile.authHeader || "";
          els.profileAuthValue.value = profile.authValue || "";
          els.profileExtraHeaders.value = JSON.stringify(profile.extraHeaders || {}, null, 2);
          els.profileNotes.value = profile.notes || "";
          scrollToSection("manageSection");
        }
        return;
      }

      const endpointItem = event.target.closest("[data-endpoint-id]");
      if (endpointItem) {
        const id = endpointItem.dataset.endpointId;
        const endpoint = state.bootstrap && state.bootstrap.catalog ? state.bootstrap.catalog.find(function (item) {
          return String(item.id) === String(id);
        }) : null;
        if (endpoint) {
          els.endpointId.value = endpoint.id || "";
          els.endpointProfile.value = endpoint.profileName || "";
          els.endpointProduct.value = endpoint.product || "";
          els.endpointService.value = endpoint.service || "";
          els.endpointMethod.value = endpoint.method || "";
          els.endpointPath.value = endpoint.path || "";
          els.endpointTitle.value = endpoint.title || "";
          els.endpointDescription.value = endpoint.description || "";
          els.endpointKeywords.value = (endpoint.keywords || []).join(", ");
          els.endpointBodyType.value = endpoint.bodyType || "none";
          els.endpointAuthHeader.value = endpoint.authHeader || "";
          els.endpointPathExample.value = endpoint.pathExample || "";
          els.endpointCurlBody.value = endpoint.curlBody || "";
          els.endpointN8nMethod.value = endpoint.n8n && endpoint.n8n.method ? endpoint.n8n.method : "";
          els.endpointN8nUrl.value = endpoint.n8n && endpoint.n8n.url ? endpoint.n8n.url : "";
          els.endpointN8nHeaders.value = JSON.stringify((endpoint.n8n && endpoint.n8n.headers) || {}, null, 2);
          els.endpointN8nBodyMode.value = endpoint.n8n && endpoint.n8n.bodyMode ? endpoint.n8n.bodyMode : "";
          scrollToSection("manageSection");
        }
      }
    });

    document.querySelectorAll(".tab-btn").forEach(function (button) {
      button.addEventListener("click", function () {
        scrollToSection(button.dataset.scroll);
      });
    });

    refreshBootstrap().catch(function (error) {
      setStatus(els.warningBox, error.message, "error");
    });
  </script>
</body>
</html>`;
}

async function handleBootstrap(req, res) {
  return sendJson(res, 200, await getBootstrap());
}

async function handleSearch(req, res) {
  try {
    return sendJson(res, 200, await searchHandler(await safeJsonBody(req)));
  } catch (error) {
    return sendJson(res, error.statusCode || 500, { error: error.message, details: error.details || null });
  }
}

async function handleTestCurl(req, res) {
  try {
    const body = await safeJsonBody(req);
    const curl = String(body.curl || "").trim();
    if (!curl) return sendJson(res, 400, { error: "Cole um curl para executar" });
    return sendJson(res, 200, await executeCurl(curl));
  } catch (error) {
    return sendJson(res, error.statusCode || 400, { error: error.message, details: error.details || null });
  }
}

async function handleCreateProfile(req, res) {
  try {
    return sendJson(res, 200, await saveProfile(await safeJsonBody(req)));
  } catch (error) {
    return sendJson(res, error.statusCode || 500, { error: error.message });
  }
}

async function handleUpdateProfile(req, res, id) {
  try {
    return sendJson(res, 200, await saveProfile({ ...(await safeJsonBody(req)), id }));
  } catch (error) {
    return sendJson(res, error.statusCode || 500, { error: error.message });
  }
}

async function handleCreateEndpoint(req, res) {
  try {
    return sendJson(res, 200, await saveEndpoint(await safeJsonBody(req)));
  } catch (error) {
    return sendJson(res, error.statusCode || 500, { error: error.message });
  }
}

async function handleUpdateEndpoint(req, res, id) {
  try {
    return sendJson(res, 200, await saveEndpoint({ ...(await safeJsonBody(req)), id }));
  } catch (error) {
    return sendJson(res, error.statusCode || 500, { error: error.message });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathName = url.pathname;

  try {
    if (req.method === "GET" && pathName === "/") return sendHtml(res, pageTemplate());
    if (req.method === "GET" && pathName === "/health") return sendJson(res, 200, { ok: true, port: PORT, supabase: Boolean(getSupabaseConfig()) });
    if (req.method === "GET" && pathName === "/api/bootstrap") return handleBootstrap(req, res);
    if (req.method === "GET" && pathName === "/api/catalog") {
      const state = await getBootstrap();
      return sendJson(res, 200, {
        count: state.catalog.length,
        products: [...new Set(state.catalog.map((item) => item.product).filter(Boolean))],
        catalog: state.catalog
      });
    }
    if (req.method === "GET" && pathName === "/api/profiles") {
      const state = await getBootstrap();
      return sendJson(res, 200, { count: state.profiles.length, profiles: state.profiles });
    }
    if (req.method === "POST" && pathName === "/api/search") return handleSearch(req, res);
    if (req.method === "POST" && pathName === "/api/query") return handleSearch(req, res);
    if (req.method === "POST" && pathName === "/api/test-curl") return handleTestCurl(req, res);
    if (req.method === "POST" && pathName === "/api/profiles") return handleCreateProfile(req, res);
    if (req.method === "PATCH" && pathName.startsWith("/api/profiles/")) return handleUpdateProfile(req, res, pathName.split("/").pop());
    if (req.method === "POST" && pathName === "/api/endpoints") return handleCreateEndpoint(req, res);
    if (req.method === "PATCH" && pathName.startsWith("/api/endpoints/")) return handleUpdateEndpoint(req, res, pathName.split("/").pop());
    if (req.method === "DELETE" && pathName.startsWith("/api/endpoints/")) {
      const id = pathName.split("/").pop();
      if (getSupabaseConfig()) {
        const deleted = await deleteSupabaseEndpoint(id);
        return sendJson(res, 200, { ok: true, deleted });
      }
      const index = runtimeEndpoints.findIndex((item) => String(item.id) === String(id));
      if (index === -1) return sendJson(res, 404, { error: "Endpoint nao encontrado" });
      runtimeEndpoints.splice(index, 1);
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    return sendJson(res, error.statusCode || 500, { error: error.message, details: error.details || null });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Assistente HTTP Request rodando em http://${HOST}:${PORT}`);
});
