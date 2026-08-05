function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) return null;

  return {
    url: url.replace(/\/$/, ""),
    key,
    endpointsTable: process.env.SUPABASE_ENDPOINTS_TABLE || "api_endpoints",
    profilesTable: process.env.SUPABASE_PROFILES_TABLE || "api_profiles"
  };
}

async function supabaseFetch(path, options = {}) {
  const config = getSupabaseConfig();
  if (!config) {
    return { ok: false, status: 503, json: async () => ({ error: "Supabase not configured" }) };
  }

  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  return response;
}

export async function loadSupabaseWorkspace() {
  const config = getSupabaseConfig();
  if (!config) return null;

  const [profilesResponse, endpointsResponse] = await Promise.all([
    supabaseFetch(`${config.profilesTable}?select=*`),
    supabaseFetch(`${config.endpointsTable}?select=*`)
  ]);

  if (!profilesResponse.ok) {
    throw new Error(`Supabase profiles query failed: ${profilesResponse.status}`);
  }

  if (!endpointsResponse.ok) {
    throw new Error(`Supabase endpoints query failed: ${endpointsResponse.status}`);
  }

  const [profilesRows, endpointRows] = await Promise.all([
    profilesResponse.json(),
    endpointsResponse.json()
  ]);

  return {
    profiles: Array.isArray(profilesRows) ? profilesRows.map(normalizeProfileRow) : [],
    endpoints: Array.isArray(endpointRows) ? endpointRows.map(normalizeEndpointRow) : []
  };
}

export async function createSupabaseProfile(profile) {
  const config = getSupabaseConfig();
  if (!config) throw new Error("Supabase not configured");

  const response = await supabaseFetch(`${config.profilesTable}`, {
    method: "POST",
    headers: {
      Prefer: "return=representation"
    },
    body: JSON.stringify(profile)
  });

  if (!response.ok) {
    throw new Error(`Supabase profile insert failed: ${response.status}`);
  }

  const rows = await response.json();
  return Array.isArray(rows) ? rows.map(normalizeProfileRow)[0] : null;
}

export async function updateSupabaseProfile(id, profile) {
  const config = getSupabaseConfig();
  if (!config) throw new Error("Supabase not configured");

  const response = await supabaseFetch(`${config.profilesTable}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      Prefer: "return=representation"
    },
    body: JSON.stringify(profile)
  });

  if (!response.ok) {
    throw new Error(`Supabase profile update failed: ${response.status}`);
  }

  const rows = await response.json();
  return Array.isArray(rows) ? rows.map(normalizeProfileRow)[0] : null;
}

export async function createSupabaseEndpoint(endpoint) {
  const config = getSupabaseConfig();
  if (!config) throw new Error("Supabase not configured");

  const response = await supabaseFetch(`${config.endpointsTable}`, {
    method: "POST",
    headers: {
      Prefer: "return=representation"
    },
    body: JSON.stringify(endpoint)
  });

  if (!response.ok) {
    throw new Error(`Supabase endpoint insert failed: ${response.status}`);
  }

  const rows = await response.json();
  return Array.isArray(rows) ? rows.map(normalizeEndpointRow)[0] : null;
}

export async function updateSupabaseEndpoint(id, endpoint) {
  const config = getSupabaseConfig();
  if (!config) throw new Error("Supabase not configured");

  const response = await supabaseFetch(`${config.endpointsTable}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      Prefer: "return=representation"
    },
    body: JSON.stringify(endpoint)
  });

  if (!response.ok) {
    throw new Error(`Supabase endpoint update failed: ${response.status}`);
  }

  const rows = await response.json();
  return Array.isArray(rows) ? rows.map(normalizeEndpointRow)[0] : null;
}

export async function deleteSupabaseEndpoint(id) {
  const config = getSupabaseConfig();
  if (!config) throw new Error("Supabase not configured");

  const response = await supabaseFetch(`${config.endpointsTable}?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: {
      Prefer: "return=representation"
    }
  });

  if (!response.ok) {
    throw new Error(`Supabase endpoint delete failed: ${response.status}`);
  }

  const rows = await response.json();
  return Array.isArray(rows) ? rows.map(normalizeEndpointRow)[0] : null;
}

function normalizeProfileRow(row) {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url ?? row.baseUrl ?? "",
    authHeader: row.auth_header ?? row.authHeader ?? "none",
    authValue: row.auth_value ?? row.authValue ?? "",
    extraHeaders: row.extra_headers ?? row.extraHeaders ?? {},
    notes: row.notes ?? "",
    createdAt: row.created_at ?? row.createdAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null
  };
}

function normalizeEndpointRow(row) {
  return {
    id: row.id,
    profileName: row.profile_name ?? row.profileName ?? "",
    product: row.product,
    service: row.service,
    method: row.method,
    path: row.path,
    authHeader: row.auth_header ?? row.authHeader ?? "none",
    bodyType: row.body_type ?? row.bodyType ?? "none",
    title: row.title,
    description: row.description ?? "",
    keywords: row.keywords ?? [],
    pathExample: row.path_example ?? row.pathExample ?? "",
    curlBody: row.curl_body ?? row.curlBody ?? "",
    n8n: {
      method: row.n8n_method ?? row.n8nMethod ?? row.method ?? "GET",
      url: row.n8n_url ?? row.n8nUrl ?? row.path_example ?? row.pathExample ?? "",
      headers: row.n8n_headers ?? row.n8nHeaders ?? {},
      bodyMode: row.n8n_body_mode ?? row.n8nBodyMode ?? "none"
    }
  };
}

export { getSupabaseConfig };
