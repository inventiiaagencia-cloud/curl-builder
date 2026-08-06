import http from "node:http";
import { readFileSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawn } from "node:child_process";
import { catalog as seedCatalog } from "../data/catalog.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carrega o .env manualmente (se existir) para nao depender da flag --env-file,
// que quebra em ambientes como EasyPanel/Nixpacks quando o arquivo nao existe.
// Variaveis ja definidas no ambiente (container) tem prioridade.
function loadEnvFile() {
  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(__dirname, "..", ".env"),
    path.join(__dirname, ".env")
  ];
  for (const filePath of candidates) {
    let raw = "";
    try {
      raw = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      const key = match[1];
      if (process.env[key] === undefined) {
        process.env[key] = match[2].replace(/^["']|["']$/g, "");
      }
    }
    break;
  }
}
loadEnvFile();

const PORT = Number(process.env.PORT || 3020);
const HOST = process.env.HOST || "0.0.0.0";
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "");
const DOCS_BASE_URL = "https://docs.evolutionfoundation.com.br";

const PRODUCTS = [
  { value: "evolution_api", label: "Evolution API" },
  { value: "evo_go", label: "EVO-GO" },
  { value: "evo_crm", label: "EVO CRM" }
];

const PRODUCT_LABELS = Object.fromEntries(PRODUCTS.map((item) => [item.value, item.label]));
const ENVIRONMENT_TABLE_CANDIDATES = ["environments", "api_profiles"];
const HISTORY_TABLE_CANDIDATES = ["curl_history"];
const OFFICIAL_PRODUCT_PREFIXES = [
  { match: /\/Evolution-API\//i, product: "evolution_api" },
  { match: /\/Evolution-Go\//i, product: "evo_go" },
  { match: /\/EvoAI-(CRM|Core|Processor|Knowledge)-Service\//i, product: "evo_crm" },
  { match: /\/Evo-Auth-Service\//i, product: "evo_crm" }
];
const LOCAL_RUNTIME_STATE_FILE = resolveRuntimeStateFile();
const OFFICIAL_CATALOG_CACHE_FILE = path.join(__dirname, ".official-catalog-cache.json");
const OFFICIAL_CATALOG_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const OFFICIAL_CATALOG_SYNC_BUDGET_MS = 10000; // orcamento total de sincronizacao a frio
const OFFICIAL_CATALOG_FETCH_TIMEOUT_MS = 10000;
const OFFICIAL_CATALOG_CONCURRENCY = 6;

let officialCatalogCache = null;
let officialCatalogPromise = null;
const runtimeEnvironments = [];
const runtimeHistory = [];
let runtimeStateHydrated = false;

function hasSupabaseConfig() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

function normalizeProduct(value) {
  const v = String(value || "").trim().toLowerCase();
  if (v === "evolution api" || v === "evolution_api") return "evolution_api";
  if (v === "evolution go" || v === "evo-go" || v === "evo go" || v === "evo_go") return "evo_go";
  if (v === "evolution crm" || v === "evo crm" || v === "evo_crm") return "evo_crm";
  return v;
}

function productLabel(product) {
  return PRODUCT_LABELS[product] || product || "";
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

function sendText(res, statusCode, data, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, { "Content-Type": contentType });
  res.end(data);
}

function cloneRuntimeValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function readRuntimeStateSnapshot() {
  return {
    environments: runtimeEnvironments.map((item) => cloneRuntimeValue(item)),
    history: runtimeHistory.map((item) => cloneRuntimeValue(item))
  };
}

async function loadLocalRuntimeState() {
  if (runtimeStateHydrated) return readRuntimeStateSnapshot();
  runtimeStateHydrated = true;

  try {
    const raw = await readFile(LOCAL_RUNTIME_STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const environments = Array.isArray(parsed?.environments) ? parsed.environments : [];
    const history = Array.isArray(parsed?.history) ? parsed.history : [];

    runtimeEnvironments.splice(0, runtimeEnvironments.length, ...environments);
    runtimeHistory.splice(0, runtimeHistory.length, ...history);
  } catch {
    // File nao existe ou esta invalido; seguimos com memoria limpa.
  }

  return readRuntimeStateSnapshot();
}

async function persistLocalRuntimeState() {
  try {
    await mkdir(path.dirname(LOCAL_RUNTIME_STATE_FILE), { recursive: true });
    await writeFile(LOCAL_RUNTIME_STATE_FILE, JSON.stringify(readRuntimeStateSnapshot(), null, 2), "utf8");
  } catch {
    // Persistencia local eh best-effort.
  }
}

function isTransportFailure(error) {
  const message = String(error?.message || error || "");
  return /fetch failed|network|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|CORS/i.test(message);
}

async function sendFile(res, filePath, contentType) {
  const content = await readFile(filePath, "utf8");
  sendText(res, 200, content, contentType);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

async function readSafeJsonBody(req) {
  try {
    return await readJsonBody(req);
  } catch (error) {
    const err = new Error("JSON invalido no corpo da requisicao");
    err.statusCode = 400;
    err.details = error.message;
    throw err;
  }
}

function toObject(value, fallback = {}) {
  if (value == null || value === "") return { ...fallback };
  if (typeof value === "object" && !Array.isArray(value)) return { ...value };
  try {
    const parsed = JSON.parse(String(value));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    return { ...fallback };
  }
  return { ...fallback };
}

function toTags(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function normalizeMethod(value) {
  return String(value || "GET").trim().toUpperCase();
}

function joinUrl(baseUrl = "", targetPath = "") {
  const base = String(baseUrl || "").trim().replace(/\/+$/, "");
  const target = String(targetPath || "").trim();
  if (!base) return target;
  if (!target) return base;
  if (/^https?:\/\//i.test(target)) return target;
  return `${base}${target.startsWith("/") ? "" : "/"}${target}`;
}

function hostnameFromUrl(value = "") {
  try {
    return new URL(String(value)).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function resolveRuntimeStateFile() {
  const configured = String(process.env.RUNTIME_STATE_FILE || process.env.LOCAL_RUNTIME_STATE_FILE || "").trim();
  if (!configured) return path.join(__dirname, ".runtime-state.json");
  return path.isAbsolute(configured) ? configured : path.resolve(__dirname, configured);
}

function extractPathParams(pathText = "") {
  return [...String(pathText).matchAll(/\{([^}/]+)\}/g)].map((match) => match[1]).filter(Boolean);
}

function sampleValueForParam(name = "") {
  const lower = String(name).toLowerCase();
  if (lower.includes("instance")) return "minha-instancia";
  if (lower.includes("webhook")) return "https://seu-webhook.com";
  if (lower.includes("url")) return "https://exemplo.com";
  if (lower.includes("number") || lower.includes("phone")) return "5511999999999";
  if (lower.includes("token")) return "SEU_TOKEN";
  if (lower.endsWith("_id") || lower.includes("id")) return String(name).toUpperCase();
  if (lower.includes("name")) return "exemplo";
  return "valor";
}

function shellQuote(value = "") {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function slugify(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function titleize(value = "") {
  return String(value)
    .split(/[-_/.\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function repairMojibakeText(value = "") {
  const raw = String(value || "");
  if (!/[ÃÂâ€]/.test(raw)) return raw;
  try {
    const repaired = Buffer.from(raw, "latin1").toString("utf8");
    if (repaired && repaired !== raw) return repaired;
  } catch {
    // Mantem o texto original se a tentativa de reparo falhar.
  }
  return raw;
}

function localizeDescription(description = "", fallbackName = "") {
  const raw = repairMojibakeText(String(description || "").trim());
  const fallback = String(fallbackName || "").trim();
  if (!raw || raw === ">-" || raw === "|" || raw === "-" || !/[A-Za-z]/.test(raw)) {
    if (!fallback) return "";
    return localizeDescription(fallback, "");
  }

  const exact = {
    "Add a new Agent to Inbox": "Adicionar um novo agente na caixa de entrada.",
    "Add a resource scope to a custom role": "Adicionar um escopo de recurso a uma funcao personalizada.",
    "Add a permission to a custom role": "Adicionar uma permissao a uma funcao personalizada.",
    "Add a conversation or contact to the pipeline": "Adicionar uma conversa ou contato ao pipeline.",
    "Assign a conversation to an agent or a team": "Atribuir uma conversa a um agente ou equipe.",
    "Check if user has a specific permission": "Verificar se o usuario tem uma permissao especifica.",
    "Configure proxy for instance": "Configurar o proxy da instancia.",
    "Configure webhook for events": "Configurar webhook para eventos.",
    "Configure WebSocket events": "Configurar eventos de WebSocket.",
    "Configure instance settings": "Configurar as definicoes da instancia.",
    "Create multiple users for current account (requires account-id header)": "Criar varios usuarios para a conta atual (requer o header account-id).",
    "Create a subtask under an existing task (max 3 hierarchy levels)": "Criar uma subtarefa abaixo de uma tarefa existente (maximo de 3 niveis).",
    "Delete all sessions in bulk": "Excluir todas as sessoes em lote.",
    "Generate QR code / pairing of the instance": "Gerar QR code / pareamento da instancia.",
    "Health check endpoint for API": "Endpoint de verificacao de saude da API.",
    "List conversations with pagination": "Listar conversas com paginacao.",
    "List products from catalog": "Listar produtos do catalogo.",
    "Marks the scheduled action as cancelled, preventing its execution": "Marcar a acao agendada como cancelada, impedindo sua execucao.",
    "Move multiple items to a new stage at once": "Mover varios itens para uma nova etapa de uma vez.",
    "Send a text message": "Enviar uma mensagem de texto.",
    "Send contact card": "Enviar cartao de contato.",
    "Send interactive buttons message": "Enviar mensagem interativa com botoes.",
    "Send interactive list message": "Enviar mensagem interativa em lista.",
    "Send location message": "Enviar mensagem de localizacao.",
    "Send media (image, video, document, audio)": "Enviar midia (imagem, video, documento ou audio).",
    "Send emoji reaction to message": "Enviar reacao em emoji para a mensagem.",
    "Send poll message": "Enviar enquete.",
    "Send WhatsApp Business template message": "Enviar mensagem de template do WhatsApp Business.",
    "Set instance presence status": "Definir o status de presenca da instancia.",
    "Set pipeline as inactive": "Marcar pipeline como inativo.",
    "Update WhatsApp profile name": "Atualizar o nome do perfil do WhatsApp.",
    "Update WhatsApp profile picture": "Atualizar a foto do perfil do WhatsApp.",
    "Update WhatsApp status message": "Atualizar a mensagem de status do WhatsApp.",
    "Verify Facebook/Meta Business API credentials": "Verificar credenciais da API Business do Facebook/Meta."
  };

  if (exact[raw]) return exact[raw];

  let text = raw;
  const replacements = [
    [/\bAdd\b/gi, "Adicionar"],
    [/\bArchive\b/gi, "Arquivar"],
    [/\bAssign\b/gi, "Atribuir"],
    [/\bAttach\b/gi, "Anexar"],
    [/\bBulk\b/gi, "Em lote"],
    [/\bCheck\b/gi, "Verificar"],
    [/\bConnect\b/gi, "Conectar"],
    [/\bConfigure\b/gi, "Configurar"],
    [/\bCreate\b/gi, "Criar"],
    [/\bDelete\b/gi, "Excluir"],
    [/\bGenerate\b/gi, "Gerar"],
    [/\bGet\b/gi, "Obter"],
    [/\bList\b/gi, "Listar"],
    [/\bMark\b/gi, "Marcar"],
    [/\bMove\b/gi, "Mover"],
    [/\bRemove\b/gi, "Remover"],
    [/\bSearch\b/gi, "Buscar"],
    [/\bSend\b/gi, "Enviar"],
    [/\bSet\b/gi, "Definir"],
    [/\bUpdate\b/gi, "Atualizar"],
    [/\bVerify\b/gi, "Verificar"],
    [/\bmessage\b/gi, "mensagem"],
    [/\bmessages\b/gi, "mensagens"],
    [/\bcontact\b/gi, "contato"],
    [/\bcontacts\b/gi, "contatos"],
    [/\bconversation\b/gi, "conversa"],
    [/\bconversations\b/gi, "conversas"],
    [/\blabels\b/gi, "etiquetas"],
    [/\blabel\b/gi, "etiqueta"],
    [/\binbox\b/gi, "caixa de entrada"],
    [/\bpipeline\b/gi, "pipeline"],
    [/\bsettings\b/gi, "configuracoes"],
    [/\bsession\b/gi, "sessao"],
    [/\bsessions\b/gi, "sessoes"],
    [/\bstatus\b/gi, "status"],
    [/\bpresence\b/gi, "presenca"],
    [/\bcredentials\b/gi, "credenciais"],
    [/\btemplate\b/gi, "template"],
    [/\bpoll\b/gi, "enquete"],
    [/\breaction\b/gi, "reacao"],
    [/\bmedia\b/gi, "midia"],
    [/\blocation\b/gi, "localizacao"],
    [/\bproducts\b/gi, "produtos"]
  ];

  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }

  text = text.replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
  if (!/[.!?]$/.test(text)) text += ".";
  return text;
}

function replaceTemplateString(text, variables) {
  const raw = String(text ?? "");
  return raw
    .replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key) => String(variables[key] ?? ""))
    .replace(/\{\s*([a-zA-Z0-9_.-]+)\s*\}/g, (_, key) => String(variables[key] ?? ""));
}

function deepReplace(value, variables) {
  if (Array.isArray(value)) return value.map((item) => deepReplace(item, variables));
  if (value && typeof value === "object") {
    const result = {};
    for (const [key, item] of Object.entries(value)) result[key] = deepReplace(item, variables);
    return result;
  }
  if (typeof value === "string") return replaceTemplateString(value, variables);
  return value;
}

function stringifyBody(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

async function fetchText(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "text/plain, text/yaml, application/yaml, application/x-yaml, */*"
      }
    });
    if (!response.ok) {
      throw new Error(`Falha ao baixar ${url}: ${response.status}`);
    }
    return response.text();
  } finally {
    clearTimeout(timer);
  }
}

function getServiceSlugFromUrl(url = "") {
  const match = String(url).match(/\/openapi\/([^/]+)\//i);
  return match ? match[1] : "";
}

function productFromSpecUrl(url = "") {
  for (const entry of OFFICIAL_PRODUCT_PREFIXES) {
    if (entry.match.test(url)) return entry.product;
  }
  return null;
}

function specTagsForUrl(url = "") {
  const serviceSlug = getServiceSlugFromUrl(url);
  const product = productFromSpecUrl(url);
  const tags = [];
  if (product) tags.push(productLabel(product));
  if (serviceSlug) tags.push(titleize(serviceSlug));
  return tags;
}

function parseOfficialSpecUrls(llmsText = "") {
  return [...String(llmsText).matchAll(/\((https:\/\/docs\.evolutionfoundation\.com\.br\/api-reference\/openapi\/[^)]+?\.(?:ya?ml|json))\)/gi)]
    .map((match) => match[1])
    .filter((url) => /\/openapi\//i.test(url));
}

function parseYamlEndpoints(yamlText, specUrl) {
  const product = productFromSpecUrl(specUrl);
  if (!product) return [];

  const lines = String(yamlText).replace(/\r\n/g, "\n").split("\n");
  const specTags = specTagsForUrl(specUrl);
  const specSlug = getServiceSlugFromUrl(specUrl);
  const endpoints = [];

  let currentPath = "";
  let currentMethod = "";
  let current = null;

  for (const line of lines) {
    const pathMatch = line.match(/^  (\/[^:]*):\s*$/);
    if (pathMatch) {
      currentPath = pathMatch[1];
      currentMethod = "";
      current = null;
      continue;
    }

    const methodMatch = line.match(/^    (get|post|put|delete|patch|options|head):\s*$/i);
    if (methodMatch && currentPath) {
      currentMethod = methodMatch[1].toUpperCase();
      current = {
        product,
        name: "",
        method: currentMethod,
        path: currentPath,
        description: "",
        tags: [...specTags],
        source: "official-docs",
        docUrl: specUrl
      };
      endpoints.push(current);
      continue;
    }

    if (!current) continue;

    const summaryMatch = line.match(/^      summary:\s*(.*)\s*$/);
    if (summaryMatch) {
      current.name = summaryMatch[1].trim();
      continue;
    }

    const descriptionMatch = line.match(/^      description:\s*(.*)\s*$/);
    if (descriptionMatch && !current.description) {
      current.description = descriptionMatch[1].trim();
      continue;
    }

    const operationMatch = line.match(/^      operationId:\s*(.*)\s*$/);
    if (operationMatch && !current.name) {
      current.name = titleize(operationMatch[1].trim());
      continue;
    }

    const tagMatch = line.match(/^      -\s*(.*)\s*$/);
    if (tagMatch && /tags:\s*$/.test(lines[lines.indexOf(line) - 1] || "")) {
      current.tags.push(titleize(tagMatch[1].trim()));
      continue;
    }
  }

  return endpoints.map((endpoint) => {
    const fallbackName = endpoint.name || titleize(endpoint.path.split("/").filter(Boolean).slice(-1)[0] || `${endpoint.method} endpoint`);
    const normalizedPath = String(endpoint.path || "");
    const hasBody = !["GET", "DELETE"].includes(endpoint.method);
    const productHeaders = endpoint.product === "evo_crm"
      ? { api_access_token: "{{api_key}}" }
      : { apikey: "{{api_key}}" };

    const pathTokens = normalizedPath.split("/").filter(Boolean).map((segment) => segment.replace(/[{}]/g, ""));
    const tags = [...new Set([
      ...endpoint.tags,
      endpoint.product,
      endpoint.productLabel,
      ...pathTokens.map((segment) => titleize(segment)),
      fallbackName
    ].filter(Boolean))];

    return {
      id: `${endpoint.product}::${endpoint.method}::${normalizedPath}::${slugify(fallbackName)}`,
      product: endpoint.product,
      productLabel: productLabel(endpoint.product),
      name: fallbackName,
      method: endpoint.method,
      path: normalizedPath,
      pathExample: joinUrl(endpoint.product === "evo_go" ? "http://localhost:8080" : "https://api.evoai.app", normalizedPath),
      headersTemplate: productHeaders,
      bodyTemplate: hasBody ? "" : "",
      tags,
      description: localizeDescription(endpoint.description || fallbackName, fallbackName),
      authHeader: endpoint.product === "evo_crm" ? "api_access_token" : "apikey",
      bodyType: hasBody ? (/(media|file|avatar|image|photo|document|upload|picture|thumbnail)/i.test(`${fallbackName} ${normalizedPath}`) ? "multipart" : "json") : "none",
      source: "official-docs",
      docUrl: endpoint.docUrl
    };
  });
}

async function readOfficialCatalogCache() {
  try {
    const raw = await readFile(OFFICIAL_CATALOG_CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.endpoints)) {
      return { endpoints: parsed.endpoints, fetchedAt: Number(parsed.fetchedAt) || 0 };
    }
  } catch {
    // Cache ausente ou invalido; segue sem cache.
  }
  return null;
}

async function writeOfficialCatalogCache(endpoints, fresh = true) {
  try {
    await writeFile(
      OFFICIAL_CATALOG_CACHE_FILE,
      JSON.stringify({ fetchedAt: fresh ? Date.now() : 0, endpoints }, null, 2),
      "utf8"
    );
  } catch {
    // Cache em disco eh best-effort.
  }
}

function fetchSpecsInParallel(specUrls, { startedAt, budgetMs }) {
  let nextIndex = 0;
  const collected = [];

  async function worker() {
    while (nextIndex < specUrls.length) {
      if (Date.now() - startedAt > budgetMs) return;
      const specUrl = specUrls[nextIndex];
      nextIndex += 1;
      try {
        const yamlText = await fetchText(specUrl, OFFICIAL_CATALOG_FETCH_TIMEOUT_MS);
        collected.push(...parseYamlEndpoints(yamlText, specUrl));
      } catch {
        // Spec indisponivel; segue para a proxima.
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(OFFICIAL_CATALOG_CONCURRENCY, Math.max(specUrls.length, 1)) },
    () => worker()
  );
  return Promise.all(workers).then(() => ({
    endpoints: collected,
    // true apenas se TODAS as specs foram processadas (orcamento nao cortou a sincronizacao).
    complete: nextIndex >= specUrls.length
  }));
}

async function syncOfficialCatalog() {
  const startedAt = Date.now();
  const llmsText = await fetchText(`${DOCS_BASE_URL}/llms.txt`, OFFICIAL_CATALOG_FETCH_TIMEOUT_MS);
  const specUrls = parseOfficialSpecUrls(llmsText).filter((url) => productFromSpecUrl(url));
  const { endpoints: fetchedEndpoints, complete } = await fetchSpecsInParallel(specUrls, {
    startedAt,
    budgetMs: OFFICIAL_CATALOG_SYNC_BUDGET_MS
  });

  const entriesByKey = new Map();
  for (const endpoint of fetchedEndpoints) {
    const key = `${endpoint.product}::${endpoint.method}::${endpoint.path}`;
    if (!entriesByKey.has(key)) entriesByKey.set(key, endpoint);
  }

  return {
    complete,
    endpoints: [...entriesByKey.values()].sort((a, b) => {
      const byProduct = a.product.localeCompare(b.product);
      if (byProduct !== 0) return byProduct;
      const byPath = a.path.localeCompare(b.path);
      if (byPath !== 0) return byPath;
      return a.method.localeCompare(b.method);
    })
  };
}

function refreshOfficialCatalogInBackground() {
  if (officialCatalogPromise) return officialCatalogPromise;
  officialCatalogPromise = (async () => {
    try {
      const result = await syncOfficialCatalog();
      officialCatalogCache = result.endpoints;
      await writeOfficialCatalogCache(result.endpoints, result.complete);
      return result.endpoints;
    } catch {
      if (!Array.isArray(officialCatalogCache)) officialCatalogCache = [];
      return officialCatalogCache;
    } finally {
      officialCatalogPromise = null;
    }
  })();
  return officialCatalogPromise;
}

async function loadOfficialCatalog() {
  if (Array.isArray(officialCatalogCache)) return officialCatalogCache;
  if (officialCatalogPromise) return officialCatalogPromise;

  const cached = await readOfficialCatalogCache();
  // Re-checa apos o await para evitar corrida entre requisicoes concorrentes.
  if (Array.isArray(officialCatalogCache)) return officialCatalogCache;
  if (officialCatalogPromise) return officialCatalogPromise;

  if (cached && Array.isArray(cached.endpoints)) {
    if (Date.now() - cached.fetchedAt < OFFICIAL_CATALOG_CACHE_TTL_MS) {
      // Cache fresco: resposta instantanea, sem rede.
      officialCatalogCache = cached.endpoints;
      return officialCatalogCache;
    }
    // Cache expirado ou parcial (fetchedAt 0): usa o cache existente
    // enquanto a sincronizacao completa roda em background.
    officialCatalogCache = cached.endpoints;
    refreshOfficialCatalogInBackground().catch(() => {});
    return officialCatalogCache;
  }

  // Primeira execucao (sem cache): sincroniza com orcamento de tempo.
  officialCatalogPromise = (async () => {
    try {
      const result = await syncOfficialCatalog();
      officialCatalogCache = result.endpoints;
      await writeOfficialCatalogCache(result.endpoints, result.complete);
      return result.endpoints;
    } catch {
      officialCatalogCache = [];
      return officialCatalogCache;
    } finally {
      officialCatalogPromise = null;
    }
  })();
  return officialCatalogPromise;
}

function mergeCatalogEntries(primaryEntries, fallbackEntries) {
  const merged = new Map();

  for (const item of fallbackEntries) {
    merged.set(`${item.product}::${item.method}::${item.path}`, item);
  }

  for (const item of primaryEntries) {
    const key = `${item.product}::${item.method}::${item.path}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, item);
      continue;
    }

    merged.set(key, {
      ...existing,
      ...item,
      headersTemplate: Object.keys(item.headersTemplate || {}).length ? item.headersTemplate : existing.headersTemplate,
      bodyTemplate: String(item.bodyTemplate || "").trim() ? item.bodyTemplate : existing.bodyTemplate,
      description: item.description || existing.description,
      tags: [...new Set([...(existing.tags || []), ...(item.tags || [])])],
      pathExample: item.pathExample || existing.pathExample,
      source: item.source || existing.source
    });
  }

  return [...merged.values()].sort((a, b) => {
    const byProduct = a.product.localeCompare(b.product);
    if (byProduct !== 0) return byProduct;
    const byName = a.name.localeCompare(b.name);
    if (byName !== 0) return byName;
    return a.path.localeCompare(b.path);
  });
}

function mergeRuntimeEntries(remoteEntries, localEntries) {
  const merged = [...(Array.isArray(remoteEntries) ? remoteEntries : [])];
  const seen = new Set(merged.map((item) => String(item.id)));
  for (const item of localEntries) {
    if (!item || seen.has(String(item.id))) continue;
    seen.add(String(item.id));
    merged.push(item);
  }
  return merged;
}

function buildCurlCommand({ method, url, headers, body }) {
  const lines = [`curl --request ${method} \\`, `  --url ${shellQuote(url)}`];
  for (const [key, value] of Object.entries(headers || {})) {
    if (value == null || String(value).trim() === "") continue;
    lines.push(`  --header ${shellQuote(`${key}: ${String(value)}`)}`);
  }
  if (body != null && String(body).trim() !== "") {
    lines.push(`  --data-raw ${shellQuote(stringifyBody(body))}`);
  }
  return lines.join(" \\\n");
}

function normalizeSeedCatalog() {
  return seedCatalog.map((entry, index) => {
    const product = normalizeProduct(entry.product);
    return {
      id: `${product}::${normalizeMethod(entry.method)}::${String(entry.path || "")}::${index}`,
      product,
      productLabel: productLabel(product),
      name: entry.title || "Endpoint",
      method: normalizeMethod(entry.method),
      path: entry.path || "",
      pathExample: entry.pathExample || "",
      headersTemplate: entry.n8n?.headers || {},
      bodyTemplate: entry.curlBody || "",
      tags: Array.isArray(entry.keywords) ? entry.keywords : [],
      description: localizeDescription(entry.description || "", entry.title || ""),
      authHeader: entry.authHeader || "none",
      bodyType: entry.bodyType || "none",
      source: "seed",
      n8n: entry.n8n || {}
    };
  });
}

function getPlaceholderBaseUrl(endpoint) {
  if (endpoint?.pathExample) {
    try {
      const url = new URL(endpoint.pathExample);
      return `${url.protocol}//${url.host}`;
    } catch {
      return endpoint.pathExample.replace(/\/+$/, "");
    }
  }
  if (endpoint?.product === "evo_crm") return "https://api.evoai.app";
  return "http://localhost:8080";
}

function normalizeEnvironmentRow(row) {
  return {
    id: row.id,
    name: row.name ?? "",
    product: normalizeProduct(row.product),
    productLabel: productLabel(normalizeProduct(row.product)),
    baseUrl: row.base_url ?? "",
    apiKey: row.api_key ?? "",
    extraHeaders: toObject(row.extra_headers, {}),
    createdAt: row.created_at ?? null
  };
}

function normalizeHistoryRow(row, maps = {}) {
  return {
    id: row.id,
    endpointId: row.endpoint_id ?? "",
    environmentId: row.environment_id ?? null,
    endpointName: maps.endpointNames?.get(String(row.endpoint_id)) || "",
    environmentName: maps.environmentNames?.get(String(row.environment_id)) || "",
    product: maps.endpointProducts?.get(String(row.endpoint_id)) || "",
    productLabel: productLabel(maps.endpointProducts?.get(String(row.endpoint_id))),
    finalCurl: row.final_curl ?? "",
    statusCode: row.status_code ?? 0,
    responseBody: row.response_body ?? null,
    errorMessage: row.error_message ?? null,
    testedAt: row.tested_at ?? null
  };
}

function parseJsonTemplate(value, fallback, label) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    const error = new Error(`${label} precisa ser JSON valido`);
    error.statusCode = 400;
    throw error;
  }
}

function buildRequestPlan(endpoint, environment, overrides = {}) {
  const pathParams = {
    ...Object.fromEntries(extractPathParams(endpoint.path).map((name) => [name, sampleValueForParam(name)])),
    ...toObject(overrides.pathValues, {})
  };

  const variables = {
    api_key: environment.apiKey || "",
    apiKey: environment.apiKey || "",
    token: environment.apiKey || "",
    base_url: environment.baseUrl || "",
    baseUrl: environment.baseUrl || "",
    product: endpoint.product,
    productLabel: endpoint.productLabel,
    environment_name: environment.name || "",
    environmentName: environment.name || "",
    ...pathParams
  };

  const resolvedPath = replaceTemplateString(endpoint.path, variables);
  const url = joinUrl(environment.baseUrl, resolvedPath);
  const headers = deepReplace({ ...(environment.extraHeaders || {}), ...(endpoint.headersTemplate || {}) }, variables);
  const bodyInput = Object.prototype.hasOwnProperty.call(overrides, "bodyText")
    ? overrides.bodyText
    : endpoint.bodyTemplate;
  const body = bodyInput == null || bodyInput === "" ? null : deepReplace(parseJsonTemplate(bodyInput, null, "Body template"), variables);

  if (body != null && !Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
    headers["Content-Type"] = "application/json";
  }

  const curl = buildCurlCommand({
    method: endpoint.method,
    url,
    headers,
    body
  });

  const warnings = [];
  if (!(environment.apiKey || "").trim() && JSON.stringify(endpoint.headersTemplate || {}).includes("api_key")) {
    warnings.push("Este endpoint espera api_key, mas o ambiente nao tem chave cadastrada.");
  }
  if (/\{\{\s*[a-zA-Z0-9_.-]+\s*\}\}|\{[a-zA-Z0-9_.-]+\}/.test(curl)) {
    warnings.push("Ainda existem placeholders no curl gerado.");
  }

  return {
    request: {
      method: endpoint.method,
      url,
      headers,
      body: body == null ? null : stringifyBody(body)
    },
    pathValues: pathParams,
    curl,
    warnings
  };
}

async function executeRequest(plan, timeoutMs = 30000) {
  const controller = new AbortController();
  const startedAt = Date.now();
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);

  try {
    const response = await fetch(plan.url, {
      method: plan.method,
      headers: plan.headers,
      body: plan.body ?? undefined,
      signal: controller.signal
    });
    const durationMs = Date.now() - startedAt;
    const responseText = await response.text();
    let parsedBody = responseText;
    try {
      parsedBody = responseText ? JSON.parse(responseText) : null;
    } catch {
      parsedBody = responseText;
    }

    return {
      ok: response.ok,
      errorType: response.ok ? null : "http",
      errorMessage: response.ok ? null : `HTTP ${response.status} ${response.statusText}`.trim(),
      durationMs,
      response: {
        statusCode: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: parsedBody
      }
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = String(error?.message || error || "Erro desconhecido");
    const errorType = /timeout/i.test(message) || error === "timeout" || error?.name === "AbortError"
      ? "timeout"
      : /cors/i.test(message)
        ? "cors"
        : /fetch failed|network|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN/i.test(message)
          ? "network"
          : "error";

    return {
      ok: false,
      errorType,
      errorMessage: errorType === "timeout"
        ? `Timeout apos ${timeoutMs}ms`
        : errorType === "cors"
          ? `Bloqueio de CORS: ${message}`
          : errorType === "network"
            ? `Erro de rede: ${message}`
            : message,
      durationMs,
      response: null
    };
  } finally {
    clearTimeout(timer);
  }
}

async function supabaseFetch(pathname, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  return response;
}

async function supabaseQuery(pathname) {
  if (!hasSupabaseConfig()) return null;
  const response = await supabaseFetch(pathname);
  if (!response.ok) throw new Error(`Supabase query failed: ${response.status}`);
  return response.json();
}

async function queryFirstWorkingTable(tableCandidates) {
  for (const table of tableCandidates) {
    try {
      const rows = await supabaseQuery(`${table}?select=*`);
      return { table, rows: Array.isArray(rows) ? rows : [] };
    } catch (error) {
      if (!String(error.message || "").includes("404")) {
        throw error;
      }
    }
  }

  return { table: null, rows: [] };
}

async function loadWorkspace() {
  const seedEndpoints = normalizeSeedCatalog();
  const officialEndpoints = await loadOfficialCatalog();
  const endpoints = mergeCatalogEntries(officialEndpoints, seedEndpoints);
  const localState = await loadLocalRuntimeState();
  if (!hasSupabaseConfig()) {
    return {
      configured: false,
      warnings: officialEndpoints.length
        ? ["Defina SUPABASE_URL e SUPABASE_ANON_KEY para salvar ambientes e historico."]
        : [
            "Nao foi possivel sincronizar o catalogo oficial; usando o seed local.",
            "Defina SUPABASE_URL e SUPABASE_ANON_KEY para salvar ambientes e historico."
          ],
      environments: localState.environments,
      endpoints,
      history: localState.history,
      environmentTable: null,
      historyTable: null
    };
  }

  try {
    const [environmentResult, historyResult] = await Promise.all([
      queryFirstWorkingTable(ENVIRONMENT_TABLE_CANDIDATES),
      queryFirstWorkingTable(HISTORY_TABLE_CANDIDATES)
    ]);

    const environments = environmentResult.table === "api_profiles"
      ? (Array.isArray(environmentResult.rows) ? environmentResult.rows.map(normalizeLegacyEnvironmentRow) : [])
      : (Array.isArray(environmentResult.rows) ? environmentResult.rows.map(normalizeEnvironmentRow) : []);
    const endpointNames = new Map(endpoints.map((item) => [String(item.id), item.name]));
    const endpointProducts = new Map(endpoints.map((item) => [String(item.id), item.product]));
    const environmentNames = new Map(environments.map((item) => [String(item.id), item.name]));
    const mergedEnvironments = mergeRuntimeEntries(environments, runtimeEnvironments);
    const mergedEnvironmentNames = new Map(mergedEnvironments.map((item) => [String(item.id), item.name]));
    const history = Array.isArray(historyResult.rows)
      ? historyResult.rows.map((row) => normalizeHistoryRow(row, { endpointNames, endpointProducts, environmentNames }))
      : [];
    const mergedHistory = mergeRuntimeEntries(history, runtimeHistory).map((row) =>
      typeof row?.endpoint_id === "undefined"
        ? row
        : normalizeHistoryRow(row, {
            endpointNames,
            endpointProducts,
            environmentNames: mergedEnvironmentNames
          })
    );

    const warnings = [];
    if (environmentResult.table === "api_profiles") {
      warnings.push("Usando tabela legada api_profiles para ambientes.");
    }
    const missingTables = [];
    if (!environmentResult.table) missingTables.push("environments");
    if (!historyResult.table) missingTables.push("curl_history");
    if (missingTables.length) {
      warnings.push(`Conectado ao Supabase, mas faltam as tabelas ${missingTables.join(" e ")}. Rode o supabase-schema.sql no SQL editor.`);
    }

    return {
      configured: true,
      warnings,
      environments: mergedEnvironments,
      endpoints,
      history: mergedHistory,
      environmentTable: environmentResult.table || "environments",
      historyTable: historyResult.table || "curl_history"
    };
  } catch (error) {
    const mergedEnvironments = localState.environments;
    const mergedHistory = localState.history;
    return {
      configured: true,
      warnings: ["Supabase indisponivel: usando persistencia local em arquivo ate a conexao voltar."],
      environments: mergedEnvironments,
      endpoints,
      history: mergedHistory,
      environmentTable: null,
      historyTable: null
    };
  }
}

function normalizeEnvironmentPayload(body = {}) {
  return {
    name: String(body.name || "").trim(),
    product: normalizeProduct(body.product),
    baseUrl: String(body.baseUrl || body.base_url || "").trim(),
    apiKey: String(body.apiKey || body.api_key || "").trim(),
    extraHeaders: parseJsonTemplate(body.extraHeaders || body.extra_headers || {}, {}, "Headers extras")
  };
}

function normalizeLegacyEnvironmentRow(row) {
  const extraHeaders = toObject(row.extra_headers ?? row.extraHeaders ?? {}, {});
  const product = normalizeProduct(
    row.product ??
      extraHeaders._product ??
      row.notes?.match?.(/product\s*=\s*([a-z_]+)/i)?.[1] ??
      "evolution_api"
  );

  return {
    id: row.id,
    name: row.name ?? "",
    product,
    productLabel: productLabel(product),
    baseUrl: row.base_url ?? row.baseUrl ?? "",
    apiKey: row.auth_value ?? row.apiKey ?? "",
    extraHeaders,
    notes: row.notes ?? "",
    createdAt: row.created_at ?? null
  };
}

function encodeLegacyNotes(product, notes = "") {
  const cleanNotes = String(notes || "").trim();
  return cleanNotes ? `${cleanNotes}\nproduct=${product}` : `product=${product}`;
}

async function createEnvironment(body) {
  const payload = normalizeEnvironmentPayload(body);
  if (!payload.name || !payload.product || !payload.baseUrl) {
    const error = new Error("Preencha nome, produto e base URL");
    error.statusCode = 400;
    throw error;
  }

  const workspace = await loadWorkspace();
  const duplicate = workspace.environments.find((item) =>
    item.product === payload.product && item.name.toLowerCase() === payload.name.toLowerCase()
  );
  if (duplicate) {
    const error = new Error("Ja existe um ambiente com esse nome para este produto");
    error.statusCode = 409;
    throw error;
  }

  if (!workspace.environmentTable) {
    const created = {
      id: `runtime-environment-${Date.now()}`,
      name: payload.name,
      product: payload.product,
      productLabel: productLabel(payload.product),
      baseUrl: payload.baseUrl,
      apiKey: payload.apiKey,
      extraHeaders: payload.extraHeaders,
      notes: encodeLegacyNotes(payload.product),
      createdAt: new Date().toISOString()
    };
    runtimeEnvironments.push(created);
    await persistLocalRuntimeState();
    return created;
  }

  const table = workspace.environmentTable || "environments";
  const isLegacy = table === "api_profiles";
  const payloadBody = isLegacy
    ? {
        name: payload.name,
        base_url: payload.baseUrl,
        api_key: payload.apiKey,
        auth_value: payload.apiKey,
        extra_headers: {
          ...payload.extraHeaders,
          _product: payload.product
        },
        notes: encodeLegacyNotes(payload.product)
      }
    : {
        name: payload.name,
        product: payload.product,
        base_url: payload.baseUrl,
        api_key: payload.apiKey,
        extra_headers: payload.extraHeaders
      };
  try {
    const response = await supabaseFetch(table, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(payloadBody)
    });

    if (!response.ok) throw new Error(`Falha ao salvar ambiente: ${response.status}`);
    const rows = await response.json();
    return Array.isArray(rows) ? normalizeEnvironmentRow(rows[0]) : null;
  } catch (error) {
    if (!isTransportFailure(error)) throw error;
    const created = {
      id: `runtime-environment-${Date.now()}`,
      name: payload.name,
      product: payload.product,
      productLabel: productLabel(payload.product),
      baseUrl: payload.baseUrl,
      apiKey: payload.apiKey,
      extraHeaders: payload.extraHeaders,
      notes: encodeLegacyNotes(payload.product),
      createdAt: new Date().toISOString()
    };
    runtimeEnvironments.push(created);
    await persistLocalRuntimeState();
    return created;
  }
}

async function updateEnvironment(id, body) {
  const payload = normalizeEnvironmentPayload(body);
  if (!payload.name || !payload.product || !payload.baseUrl) {
    const error = new Error("Preencha nome, produto e base URL");
    error.statusCode = 400;
    throw error;
  }

  const workspace = await loadWorkspace();
  const duplicate = workspace.environments.find((item) =>
    item.product === payload.product &&
    item.name.toLowerCase() === payload.name.toLowerCase() &&
    String(item.id) !== String(id)
  );
  if (duplicate) {
    const error = new Error("Ja existe um ambiente com esse nome para este produto");
    error.statusCode = 409;
    throw error;
  }

  if (!workspace.environmentTable) {
    const target = runtimeEnvironments.find((item) => String(item.id) === String(id));
    if (!target) {
      const error = new Error("Ambiente nao encontrado");
      error.statusCode = 404;
      throw error;
    }
    Object.assign(target, {
      name: payload.name,
      product: payload.product,
      productLabel: productLabel(payload.product),
      baseUrl: payload.baseUrl,
      apiKey: payload.apiKey,
      extraHeaders: payload.extraHeaders,
      notes: encodeLegacyNotes(payload.product)
    });
    await persistLocalRuntimeState();
    return target;
  }

  const table = workspace.environmentTable || "environments";
  const isLegacy = table === "api_profiles";
  const payloadBody = isLegacy
    ? {
        name: payload.name,
        base_url: payload.baseUrl,
        api_key: payload.apiKey,
        auth_value: payload.apiKey,
        extra_headers: {
          ...payload.extraHeaders,
          _product: payload.product
        },
        notes: encodeLegacyNotes(payload.product)
      }
    : {
        name: payload.name,
        product: payload.product,
        base_url: payload.baseUrl,
        api_key: payload.apiKey,
        extra_headers: payload.extraHeaders
      };
  try {
    const response = await supabaseFetch(`${table}?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(payloadBody)
    });

    if (!response.ok) throw new Error(`Falha ao atualizar ambiente: ${response.status}`);
    const rows = await response.json();
    return Array.isArray(rows) ? normalizeEnvironmentRow(rows[0]) : null;
  } catch (error) {
    if (!isTransportFailure(error)) throw error;
    const target = runtimeEnvironments.find((item) => String(item.id) === String(id));
    if (!target) {
      const notFound = new Error("Ambiente nao encontrado");
      notFound.statusCode = 404;
      throw notFound;
    }
    Object.assign(target, {
      name: payload.name,
      product: payload.product,
      productLabel: productLabel(payload.product),
      baseUrl: payload.baseUrl,
      apiKey: payload.apiKey,
      extraHeaders: payload.extraHeaders,
      notes: encodeLegacyNotes(payload.product)
    });
    await persistLocalRuntimeState();
    return target;
  }
}

async function deleteEnvironment(id) {
  const workspace = await loadWorkspace();
  if (!workspace.environmentTable) {
    const index = runtimeEnvironments.findIndex((item) => String(item.id) === String(id));
    if (index === -1) return null;
    const [deleted] = runtimeEnvironments.splice(index, 1);
    await persistLocalRuntimeState();
    return deleted || null;
  }
  const table = workspace.environmentTable || "environments";
  try {
    const response = await supabaseFetch(`${table}?id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Prefer: "return=representation" }
    });
    if (!response.ok) throw new Error(`Falha ao excluir ambiente: ${response.status}`);
    const rows = await response.json();
    return Array.isArray(rows) ? normalizeEnvironmentRow(rows[0]) : null;
  } catch (error) {
    if (!isTransportFailure(error)) throw error;
    const index = runtimeEnvironments.findIndex((item) => String(item.id) === String(id));
    if (index === -1) return null;
    const [deleted] = runtimeEnvironments.splice(index, 1);
    await persistLocalRuntimeState();
    return deleted || null;
  }
}

async function composeFromPayload(body) {
  const workspace = await loadWorkspace();
  const endpoint = workspace.endpoints.find((item) => String(item.id) === String(body.endpointId || ""));
  if (!endpoint) {
    const error = new Error("Endpoint nao encontrado");
    error.statusCode = 404;
    throw error;
  }

  const selectedEnvironment = body.environmentId
    ? workspace.environments.find((item) => String(item.id) === String(body.environmentId || ""))
    : null;

  if (body.environmentId && !selectedEnvironment) {
    const error = new Error("Ambiente nao encontrado");
    error.statusCode = 404;
    throw error;
  }

  if (selectedEnvironment && selectedEnvironment.product !== endpoint.product) {
    const error = new Error("O ambiente selecionado precisa ser do mesmo produto do endpoint");
    error.statusCode = 400;
    throw error;
  }

  const environment = selectedEnvironment || {
    id: "local-placeholder",
    name: "Sem ambiente",
    product: endpoint.product,
    baseUrl: getPlaceholderBaseUrl(endpoint),
    apiKey: "",
    extraHeaders: {}
  };

  const plan = buildRequestPlan(endpoint, environment, {
    pathValues: body.pathValues || {},
    bodyText: Object.prototype.hasOwnProperty.call(body, "bodyText")
      ? (body.bodyText == null || body.bodyText === "" ? null : parseJsonTemplate(body.bodyText, null, "Body editavel"))
      : undefined
  });

  return { ok: true, endpoint, environment, ...plan };
}

async function insertHistoryRow(payload) {
  const workspace = await loadWorkspace();
  if (!hasSupabaseConfig() || !workspace.historyTable) {
    const created = {
      id: `runtime-history-${Date.now()}`,
      ...payload
    };
    runtimeHistory.unshift(created);
    await persistLocalRuntimeState();
    return created;
  }
  const table = workspace.historyTable || "curl_history";
  try {
    const response = await supabaseFetch(table, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`Falha ao salvar historico: ${response.status}`);
    const rows = await response.json();
    return Array.isArray(rows) ? rows[0] : null;
  } catch (error) {
    if (!isTransportFailure(error)) throw error;
    const created = {
      id: `runtime-history-${Date.now()}`,
      ...payload
    };
    runtimeHistory.unshift(created);
    await persistLocalRuntimeState();
    return created;
  }
}

async function testRequest(body) {
  const composed = await composeFromPayload(body);
  const result = await executeRequest(composed.request, Number(body.timeoutMs || 30000));
  const historyPayload = {
    endpoint_id: composed.endpoint.id,
    environment_id: composed.environment.id === "local-placeholder" ? null : composed.environment.id,
    final_curl: composed.curl,
    status_code: result.response?.statusCode || 0,
    response_body: result.response?.body ?? null,
    error_message: result.errorMessage,
    tested_at: new Date().toISOString()
  };

  let historyWarning = null;
  try {
    await insertHistoryRow(historyPayload);
  } catch (error) {
    const message = String(error?.message || error || "");
    if (!/fetch failed|network|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN/i.test(message)) {
      historyWarning = message;
    }
  }

  return {
    ok: result.ok,
    errorType: result.errorType,
    errorMessage: result.errorMessage,
    durationMs: result.durationMs,
    curl: composed.curl,
    request: composed.request,
    response: result.response,
    warnings: [...(composed.warnings || []), ...(historyWarning ? [historyWarning] : [])]
  };
}

function assetPath(name) {
  return path.join(__dirname, name);
}

async function handleBootstrap(req, res) {
  const workspace = await loadWorkspace();
  return sendJson(res, 200, {
    ok: true,
    configured: workspace.configured,
    warnings: workspace.warnings,
    products: PRODUCTS,
    counts: {
      environments: workspace.environments.length,
      endpoints: workspace.endpoints.length,
      history: workspace.history.length
    },
    environments: workspace.environments,
    catalog: workspace.endpoints,
    history: workspace.history
  });
}

async function handleCreateEnvironment(req, res) {
  try {
    return sendJson(res, 200, await createEnvironment(await readSafeJsonBody(req)));
  } catch (error) {
    return sendJson(res, error.statusCode || 500, { error: error.message, details: error.details || null });
  }
}

async function handleUpdateEnvironment(req, res, id) {
  try {
    return sendJson(res, 200, await updateEnvironment(id, await readSafeJsonBody(req)));
  } catch (error) {
    return sendJson(res, error.statusCode || 500, { error: error.message, details: error.details || null });
  }
}

async function handleDeleteEnvironment(req, res, id) {
  try {
    return sendJson(res, 200, { ok: true, deleted: await deleteEnvironment(id) });
  } catch (error) {
    return sendJson(res, error.statusCode || 500, { error: error.message, details: error.details || null });
  }
}

async function handleCompose(req, res) {
  try {
    return sendJson(res, 200, await composeFromPayload(await readSafeJsonBody(req)));
  } catch (error) {
    return sendJson(res, error.statusCode || 500, { error: error.message, details: error.details || null });
  }
}

async function handleTest(req, res) {
  try {
    return sendJson(res, 200, await testRequest(await readSafeJsonBody(req)));
  } catch (error) {
    return sendJson(res, error.statusCode || 500, { error: error.message, details: error.details || null });
  }
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8"
};

async function serveStatic(req, res, pathname) {
  const fileName = path.basename(pathname);
  if (!["index.html", "app.js", "styles.css"].includes(fileName)) return false;
  const filePath = assetPath(fileName);
  await sendFile(res, filePath, MIME_TYPES[path.extname(fileName).toLowerCase()] || "text/plain; charset=utf-8");
  return true;
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = requestUrl.pathname;

  try {
    if (req.method === "GET" && pathname === "/") return sendFile(res, assetPath("index.html"), "text/html; charset=utf-8");
    if (req.method === "GET" && pathname === "/app.js") return sendFile(res, assetPath("app.js"), "application/javascript; charset=utf-8");
    if (req.method === "GET" && pathname === "/styles.css") return sendFile(res, assetPath("styles.css"), "text/css; charset=utf-8");
    if (req.method === "GET" && pathname === "/health") return sendJson(res, 200, { ok: true, port: PORT, configured: hasSupabaseConfig() });
    if (req.method === "GET" && pathname === "/api/bootstrap") return handleBootstrap(req, res);
    if (req.method === "POST" && pathname === "/api/environments") return handleCreateEnvironment(req, res);
    if (req.method === "PATCH" && pathname.startsWith("/api/environments/")) return handleUpdateEnvironment(req, res, pathname.split("/").pop());
    if (req.method === "DELETE" && pathname.startsWith("/api/environments/")) return handleDeleteEnvironment(req, res, pathname.split("/").pop());
    if (req.method === "POST" && pathname === "/api/compose") return handleCompose(req, res);
    if (req.method === "POST" && pathname === "/api/test") return handleTest(req, res);
    return sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    return sendJson(res, error.statusCode || 500, { error: error.message, details: error.details || null });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Curl Builder rodando em http://${HOST}:${PORT}`);
  const shouldOpenBrowser = process.env.NO_BROWSER !== "1" && process.env.NO_BROWSER !== "true";
  if (!shouldOpenBrowser || process.platform !== "win32") return;

  spawn("cmd", ["/c", "start", "", `http://localhost:${PORT}`], {
    detached: true,
    stdio: "ignore"
  }).unref();
});
