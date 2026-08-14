export class ApiError extends Error {
  constructor(message, { status = 0, code = 'NETWORK_ERROR', details = {} } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(`/api/v1${path}`, {
      credentials: 'same-origin',
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new ApiError('无法连接服务，请检查网络后重试');
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(body.error?.message || `请求失败 (${response.status})`, {
      status: response.status,
      code: body.error?.code || 'HTTP_ERROR',
      details: body.error?.details || {},
    });
  }
  return body;
}

export function safeReturnTo(value, fallback = '/') {
  if (!value || typeof value !== 'string') return fallback;
  try {
    const target = new URL(value, window.location.origin);
    if (target.origin !== window.location.origin || !target.pathname.startsWith('/') || target.pathname.startsWith('//')) return fallback;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[character]));
}

export function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false });
}
