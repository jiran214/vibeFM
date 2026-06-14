const API_BASE = '/api';

class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'ApiError';
  }
}

async function apiFetch(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const json = await response.json();
  if (!json.success) {
    throw new ApiError(json.error.code, json.error.message);
  }
  return json.data;
}

export function listWorkspaces() {
  return apiFetch('/workspaces');
}

export function createWorkspace(body) {
  return apiFetch('/workspaces', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function getWorkspaceDetail(name) {
  return apiFetch(`/workspaces/${encodeURIComponent(name)}`);
}

export function deleteWorkspace(name) {
  return apiFetch(`/workspaces/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
}

export function generateWorkspace(name, options = {}) {
  return apiFetch(`/workspaces/${encodeURIComponent(name)}/generate`, {
    method: 'POST',
    body: JSON.stringify(options),
  });
}

export function testConnection() {
  return apiFetch('/test');
}

export function searchPlaylists(query) {
  return apiFetch(`/playlists/search?q=${encodeURIComponent(query)}`);
}

export function importPlaylist(workspaceName, playlistUrl) {
  return apiFetch('/playlists/import', {
    method: 'POST',
    body: JSON.stringify({ workspaceName, playlistUrl }),
  });
}

export function getWorkspaceFileUrl(name, ...pathSegments) {
  return `${API_BASE}/workspaces/${encodeURIComponent(name)}/files/${pathSegments.join('/')}`;
}

export { ApiError };
