(function () {
  const PRODUCT_LABELS = {
    evolution_api: "Evolution API",
    evo_go: "EVO-GO",
    evo_crm: "EVO CRM"
  };

  const state = {
    bootstrap: null,
    environments: [],
    catalog: [],
    history: [],
    selectedEndpointId: "",
    selectedEnvironmentId: "",
    lastCompose: null,
    searchTimer: null,
    previewTimer: null
  };

  const els = {
    statusBanner: document.getElementById("statusBanner"),
    countEnvironments: document.getElementById("countEnvironments"),
    countEndpoints: document.getElementById("countEndpoints"),
    countHistory: document.getElementById("countHistory"),
    environmentList: document.getElementById("environmentList"),
    environmentForm: document.getElementById("environmentForm"),
    envId: document.getElementById("envId"),
    envProduct: document.getElementById("envProduct"),
    envName: document.getElementById("envName"),
    envBaseUrl: document.getElementById("envBaseUrl"),
    envApiKey: document.getElementById("envApiKey"),
    envHeaders: document.getElementById("envHeaders"),
    addEnvHeader: document.getElementById("addEnvHeader"),
    clearEnvForm: document.getElementById("clearEnvForm"),
    deleteEnvBtn: document.getElementById("deleteEnvBtn"),
    envFormStatus: document.getElementById("envFormStatus"),
    searchQuery: document.getElementById("searchQuery"),
    searchProduct: document.getElementById("searchProduct"),
    searchResults: document.getElementById("searchResults"),
    builderEmpty: document.getElementById("builderEmpty"),
    builderView: document.getElementById("builderView"),
    builderProduct: document.getElementById("builderProduct"),
    builderName: document.getElementById("builderName"),
    builderMeta: document.getElementById("builderMeta"),
    builderEnvironment: document.getElementById("builderEnvironment"),
    builderPathParams: document.getElementById("builderPathParams"),
    builderBody: document.getElementById("builderBody"),
    generatedCurl: document.getElementById("generatedCurl"),
    builderWarnings: document.getElementById("builderWarnings"),
    generateCurlBtn: document.getElementById("generateCurlBtn"),
    copyCurlBtn: document.getElementById("copyCurlBtn"),
    testCurlBtn: document.getElementById("testCurlBtn"),
    testSummary: document.getElementById("testSummary"),
    testMeta: document.getElementById("testMeta"),
    testBody: document.getElementById("testBody"),
    historyList: document.getElementById("historyList")
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function prettyJson(value) {
    if (value == null || value === "") return "-";
    if (typeof value === "string") {
      try {
        return JSON.stringify(JSON.parse(value), null, 2);
      } catch {
        return value;
      }
    }
    return JSON.stringify(value, null, 2);
  }

  function formatDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("pt-BR");
  }

  function productLabel(value) {
    return PRODUCT_LABELS[value] || value || "";
  }

  function badgeClassForMethod(method) {
    const upper = String(method || "").toUpperCase();
    if (upper === "POST" || upper === "PUT" || upper === "PATCH") return "method";
    if (upper === "DELETE") return "error";
    return "";
  }

  function extractPathParams(pathText) {
    return [...String(pathText || "").matchAll(/\{([^}/]+)\}/g)].map((match) => match[1]).filter(Boolean);
  }

  function sampleValueForParam(name) {
    const lower = String(name || "").toLowerCase();
    if (lower.includes("instance")) return "minha-instancia";
    if (lower.includes("webhook")) return "https://seu-webhook.com";
    if (lower.includes("url")) return "https://exemplo.com";
    if (lower.includes("number") || lower.includes("phone")) return "5511999999999";
    if (lower.includes("token")) return "SEU_TOKEN";
    if (lower.endsWith("_id") || lower.includes("id")) return String(name || "").toUpperCase() || "ID";
    if (lower.includes("name")) return "exemplo";
    return "valor";
  }

  function setBanner(text, kind = "info") {
    els.statusBanner.textContent = text;
    els.statusBanner.dataset.kind = kind;
    els.statusBanner.classList.remove("error", "success");
    if (kind === "error") els.statusBanner.classList.add("error");
    if (kind === "success") els.statusBanner.classList.add("success");
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      ...options
    });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (!response.ok) {
      const error = new Error(data.error || `Erro HTTP ${response.status}`);
      error.status = response.status;
      error.details = data.details || null;
      throw error;
    }
    return data;
  }

  function fillSelect(select, items, placeholder) {
    const current = select.value;
    select.innerHTML = "";
    const first = document.createElement("option");
    first.value = "";
    first.textContent = placeholder;
    select.appendChild(first);
    items.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.value;
      option.textContent = item.label;
      select.appendChild(option);
    });
    if ([...select.options].some((option) => option.value === current)) {
      select.value = current;
    }
  }

  function renderHeaderRows(container, headers = {}) {
    container.innerHTML = "";
    const entries = Object.entries(headers || {});
    if (!entries.length) {
      container.appendChild(createHeaderRow("", ""));
      return;
    }
    entries.forEach(([key, value]) => container.appendChild(createHeaderRow(key, value)));
  }

  function createHeaderRow(key = "", value = "") {
    const row = document.createElement("div");
    row.className = "kv-row";
    row.innerHTML = `
      <input type="text" class="header-key" placeholder="Header" value="${escapeHtml(key)}" />
      <input type="text" class="header-value" placeholder="Valor" value="${escapeHtml(value)}" />
      <button type="button" class="ghost small remove-row">Remover</button>
    `;
    row.querySelector(".remove-row").addEventListener("click", () => {
      row.remove();
      if (!els.envHeaders.children.length) {
        els.envHeaders.appendChild(createHeaderRow("", ""));
      }
    });
    return row;
  }

  function addHeaderRow(key = "", value = "") {
    els.envHeaders.appendChild(createHeaderRow(key, value));
  }

  function gatherHeadersRows(container) {
    const headers = {};
    container.querySelectorAll(".kv-row").forEach((row) => {
      const key = row.querySelector(".header-key")?.value?.trim();
      const value = row.querySelector(".header-value")?.value ?? "";
      if (key) headers[key] = value;
    });
    return headers;
  }

  function getEndpointById(id) {
    return state.catalog.find((item) => String(item.id) === String(id || ""));
  }

  function getEnvironmentsForProduct(product) {
    return state.environments.filter((item) => item.product === product);
  }

  function renderEnvironmentList() {
    if (!state.environments.length) {
      els.environmentList.innerHTML = '<div class="subtle">Nenhum ambiente cadastrado ainda.</div>';
      return;
    }
    els.environmentList.innerHTML = state.environments.map((item) => `
      <div class="list-item" data-env-id="${escapeHtml(item.id)}">
        <div class="item-head">
          <strong>${escapeHtml(item.name)}</strong>
          <span class="badge">${escapeHtml(item.productLabel)}</span>
        </div>
        <div class="meta">${escapeHtml(item.baseUrl || "-")}<br>${escapeHtml(item.apiKey ? "API key cadastrada" : "Sem API key")}</div>
      </div>
    `).join("");
  }

  function renderSearchResults() {
    const query = String(els.searchQuery.value || "").trim().toLowerCase();
    const productFilter = String(els.searchProduct.value || "");

    let results = state.catalog
      .map((item) => {
        if (productFilter && item.product !== productFilter) return null;
        const haystack = [
          item.name,
          item.path,
          item.productLabel,
          item.description,
          ...(item.tags || [])
        ].join(" ").toLowerCase();
        let score = query ? 0 : 1;
        for (const token of query.split(/\s+/).filter(Boolean)) {
          if (haystack.includes(token)) score += token.length >= 4 ? 3 : 1;
        }
        if (query && haystack.includes(query)) score += 6;
        return score > 0 ? { item, score } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);

    if (!results.length) {
      els.searchResults.innerHTML = '<div class="subtle">Nenhum endpoint encontrado.</div>';
      return;
    }

    els.searchResults.innerHTML = results.map(({ item }) => `
      <button class="result-item" type="button" data-endpoint-id="${escapeHtml(item.id)}">
        <div class="item-head">
          <strong>${escapeHtml(item.name)}</strong>
          <span class="badge">${escapeHtml(item.productLabel)}</span>
        </div>
        <div class="meta">
          <span class="chip ${badgeClassForMethod(item.method)}">${escapeHtml(item.method)}</span>
          <span class="subtle"> ${escapeHtml(item.path)}</span>
          <br />
          ${escapeHtml(item.description || (item.tags || []).join(", ") || "Sem observação")}
        </div>
      </button>
    `).join("");
  }

  function renderHistoryList() {
    if (!state.history.length) {
      els.historyList.innerHTML = '<div class="subtle">Nenhum teste registrado ainda.</div>';
      return;
    }

    els.historyList.innerHTML = state.history.map((item) => {
      const statusClass = item.statusCode >= 200 && item.statusCode < 300 ? "method" : "error";
      return `
        <div class="history-item">
          <div class="history-head">
            <div>
              <strong>${escapeHtml(item.endpointName || "Endpoint")}</strong>
              <div class="meta">${escapeHtml(item.environmentName || "Sem ambiente")} · ${escapeHtml(productLabel(item.product))}</div>
            </div>
            <div class="chips">
              <span class="badge">${escapeHtml(formatDate(item.testedAt))}</span>
              <span class="chip ${statusClass}">HTTP ${escapeHtml(item.statusCode || 0)}</span>
            </div>
          </div>
          <div class="meta">${escapeHtml(item.errorMessage || "Teste executado com sucesso")}</div>
        </div>
      `;
    }).join("");
  }

  function renderBuilder(endpoint) {
    if (!endpoint) {
      els.builderEmpty.classList.remove("hidden");
      els.builderView.classList.add("hidden");
      els.generatedCurl.textContent = "Escolha um endpoint para gerar o curl.";
      els.testMeta.textContent = "-";
      els.testBody.textContent = "-";
      els.builderWarnings.textContent = "";
      return;
    }

    els.builderEmpty.classList.add("hidden");
    els.builderView.classList.remove("hidden");
    els.builderProduct.textContent = endpoint.productLabel;
    els.builderName.textContent = endpoint.name;
    els.builderMeta.textContent = `${endpoint.method} · ${endpoint.path}`;

    const environments = getEnvironmentsForProduct(endpoint.product);
    fillSelect(
      els.builderEnvironment,
      [{ value: "", label: "Sem ambiente / localhost" }].concat(
        environments.map((item) => ({ value: item.id, label: item.name }))
      ),
      "Escolha um ambiente"
    );
    els.builderEnvironment.value = state.selectedEnvironmentId || "";

    const pathParams = extractPathParams(endpoint.path);
    els.builderPathParams.innerHTML = "";
    if (!pathParams.length) {
      els.builderPathParams.innerHTML = '<div class="subtle">Este endpoint não possui path params.</div>';
    } else {
      pathParams.forEach((name) => {
        const row = document.createElement("div");
        row.className = "param-row";
        const value = sampleValueForParam(name);
        row.innerHTML = `
          <label>${escapeHtml(name)}
            <input type="text" data-param-name="${escapeHtml(name)}" value="${escapeHtml(value)}" />
          </label>
        `;
        els.builderPathParams.appendChild(row);
      });
    }

    els.builderBody.value = endpoint.bodyTemplate || "";
    schedulePreview();
  }

  function collectPathValues() {
    const values = {};
    els.builderPathParams.querySelectorAll("input[data-param-name]").forEach((input) => {
      values[input.dataset.paramName] = input.value;
    });
    return values;
  }

  function collectBuilderPayload() {
    return {
      endpointId: state.selectedEndpointId,
      environmentId: els.builderEnvironment.value || undefined,
      pathValues: collectPathValues(),
      bodyText: els.builderBody.value
    };
  }

  function renderComposeResult(data) {
    state.lastCompose = data;
    els.generatedCurl.textContent = data.curl || "-";
    els.builderWarnings.textContent = (data.warnings || []).join(" | ");
    setBanner((data.warnings || []).length ? data.warnings.join(" | ") : "Curl gerado com sucesso.", (data.warnings || []).length ? "error" : "success");
  }

  function renderTestResult(data) {
    els.testSummary.textContent = data.response?.statusCode ? `HTTP ${data.response.statusCode} em ${data.durationMs}ms` : `${String(data.errorType || "erro")} em ${data.durationMs}ms`;
    els.testMeta.textContent = prettyJson({
      request: data.request,
      response: data.response,
      errorType: data.errorType,
      errorMessage: data.errorMessage
    });
    els.testBody.textContent = prettyJson(data.response?.body ?? data.errorMessage ?? "-");
    setBanner(data.ok ? "Teste executado com sucesso." : (data.errorMessage || "Falha no teste."), data.ok ? "success" : "error");
  }

  async function refreshBootstrap() {
    const data = await api("/api/bootstrap");
    state.bootstrap = data;
    state.environments = data.environments || [];
    state.catalog = data.catalog || [];
    state.history = data.history || [];

    els.countEnvironments.textContent = String(state.environments.length);
    els.countEndpoints.textContent = String(state.catalog.length);
    els.countHistory.textContent = String(state.history.length);

    if (!data.configured) {
      setBanner((data.warnings || []).join(" | "), "error");
    } else if (data.warnings && data.warnings.length) {
      setBanner(data.warnings.join(" | "), "info");
    } else {
      setBanner("Supabase conectado. Ambientes e historico prontos.", "success");
    }

    renderEnvironmentList();
    renderSearchResults();
    renderHistoryList();

    if (state.selectedEndpointId) {
      renderBuilder(getEndpointById(state.selectedEndpointId));
    } else {
      renderBuilder(null);
    }
  }

  async function generatePreview() {
    if (!state.selectedEndpointId) return;
    const data = await api("/api/compose", {
      method: "POST",
      body: JSON.stringify(collectBuilderPayload())
    });
    renderComposeResult(data);
  }

  async function testCurl() {
    if (!state.selectedEndpointId) {
      setBanner("Escolha um endpoint antes de testar.", "error");
      return;
    }
    els.testSummary.textContent = "Executando...";
    const data = await api("/api/test", {
      method: "POST",
      body: JSON.stringify(collectBuilderPayload())
    });
    renderTestResult(data);
    await refreshBootstrap();
  }

  function schedulePreview() {
    clearTimeout(state.previewTimer);
    state.previewTimer = setTimeout(() => {
      if (!state.selectedEndpointId) return;
      generatePreview().catch((error) => setBanner(error.message, "error"));
    }, 150);
  }

  function copyTextWithFallback(text) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    textarea.remove();
    return copied;
  }

  async function copyCurl() {
    const curl = state.lastCompose?.curl;
    if (!curl) {
      setBanner("Nenhum curl gerado para copiar. Escolha um endpoint primeiro.", "error");
      return;
    }

    let copied = false;
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(curl);
        copied = true;
      } catch {
        copied = false;
      }
    }
    if (!copied) copied = copyTextWithFallback(curl);

    setBanner(
      copied
        ? "Curl copiado."
        : "Nao foi possivel copiar automaticamente; selecione o texto do curl e copie manualmente.",
      copied ? "success" : "error"
    );
  }

  function renderEnvironmentForm(env) {
    if (!env) {
      els.environmentForm.reset();
      els.envId.value = "";
      renderHeaderRows(els.envHeaders, {});
      els.envFormStatus.textContent = "Selecione um ambiente para editar.";
      return;
    }

    els.envId.value = env.id || "";
    els.envProduct.value = env.product || "evolution_api";
    els.envName.value = env.name || "";
    els.envBaseUrl.value = env.baseUrl || "";
    els.envApiKey.value = env.apiKey || "";
    renderHeaderRows(els.envHeaders, env.extraHeaders || {});
    els.envFormStatus.textContent = "Editando ambiente.";
  }

  function populateEnvironmentFormById(id) {
    const env = state.environments.find((item) => String(item.id) === String(id));
    if (env) renderEnvironmentForm(env);
  }

  async function saveEnvironment(event) {
    event.preventDefault();
    const payload = {
      id: els.envId.value || undefined,
      product: els.envProduct.value,
      name: els.envName.value,
      baseUrl: els.envBaseUrl.value,
      apiKey: els.envApiKey.value,
      extraHeaders: gatherHeadersRows(els.envHeaders)
    };

    const method = payload.id ? "PATCH" : "POST";
    const url = payload.id ? `/api/environments/${encodeURIComponent(payload.id)}` : "/api/environments";
    await api(url, { method, body: JSON.stringify(payload) });
    renderEnvironmentForm(null);
    await refreshBootstrap();
  }

  async function deleteEnvironment() {
    if (!els.envId.value) return;
    if (!confirm("Excluir este ambiente?")) return;
    await api(`/api/environments/${encodeURIComponent(els.envId.value)}`, { method: "DELETE" });
    renderEnvironmentForm(null);
    await refreshBootstrap();
  }

  function selectEndpointById(id) {
    state.selectedEndpointId = String(id || "");
    const endpoint = getEndpointById(state.selectedEndpointId);
    if (!endpoint) return;
    const envs = getEnvironmentsForProduct(endpoint.product);
    const selectedStillValid = envs.some((item) => String(item.id) === String(state.selectedEnvironmentId || ""));
    if (!selectedStillValid) state.selectedEnvironmentId = "";
    renderBuilder(endpoint);
  }

  function setupEvents() {
    document.addEventListener("click", (event) => {
      const envItem = event.target.closest("[data-env-id]");
      if (envItem) {
        populateEnvironmentFormById(envItem.dataset.envId);
        return;
      }

      const endpointItem = event.target.closest("[data-endpoint-id]");
      if (endpointItem) {
        selectEndpointById(endpointItem.dataset.endpointId);
      }
    });

    els.environmentForm.addEventListener("submit", (event) => {
      saveEnvironment(event).catch((error) => {
        els.envFormStatus.textContent = error.message;
        setBanner(error.message, "error");
      });
    });

    els.clearEnvForm.addEventListener("click", () => renderEnvironmentForm(null));
    els.deleteEnvBtn.addEventListener("click", () => {
      deleteEnvironment().catch((error) => setBanner(error.message, "error"));
    });
    els.addEnvHeader.addEventListener("click", () => addHeaderRow("", ""));
    els.copyCurlBtn.addEventListener("click", () => {
      copyCurl().catch((error) => setBanner(error.message, "error"));
    });
    els.generateCurlBtn.addEventListener("click", () => {
      generatePreview().catch((error) => setBanner(error.message, "error"));
    });
    els.testCurlBtn.addEventListener("click", () => {
      testCurl().catch((error) => setBanner(error.message, "error"));
    });

    els.searchQuery.addEventListener("input", () => {
      clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(renderSearchResults, 120);
    });
    els.searchProduct.addEventListener("change", renderSearchResults);
    els.builderEnvironment.addEventListener("change", () => {
      state.selectedEnvironmentId = els.builderEnvironment.value || "";
      schedulePreview();
    });
    els.builderBody.addEventListener("input", schedulePreview);
    els.builderPathParams.addEventListener("input", schedulePreview);
  }

  async function bootstrap() {
    setBanner("Carregando dados...", "info");
    await refreshBootstrap();
  }

  setupEvents();
  bootstrap().catch((error) => setBanner(error.message, "error"));
})();
