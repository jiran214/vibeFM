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

export function connectGenerateSSE(name, options = {}, callbacks = {}) {
  const { onProgress, onComplete, onError } = callbacks;
  const params = new URLSearchParams();
  if (options.count != null) params.set('count', String(options.count));
  if (options.quality) params.set('quality', options.quality);
  if (options.voice) params.set('voice', options.voice);
  if (options.force) params.set('force', 'true');

  const url = `${API_BASE}/workspaces/${encodeURIComponent(name)}/generate?${params}`;
  const eventSource = new EventSource(url);

  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'complete') {
      onComplete?.(data.stages);
      eventSource.close();
    } else if (data.type === 'error') {
      onError?.(data.message);
      eventSource.close();
    } else {
      onProgress?.(data);
    }
  };

  eventSource.onerror = () => {
    onError?.('连接中断');
    eventSource.close();
  };

  return { close: () => eventSource.close() };
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
