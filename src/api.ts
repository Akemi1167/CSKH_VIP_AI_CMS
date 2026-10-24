let csrfToken = "";

export function setCsrfToken(value: string): void {
  csrfToken = value;
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export class ApiError extends Error {
  status: number;
  code: string;
  requestId: string;
  details?: Record<string, string[]>;

  constructor(status: number, code: string, message: string, requestId: string, details?: Record<string, string[]>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
  }
}

type Options = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
};

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const method = options.method ?? (options.body === undefined ? "GET" : "POST");
  const headers = new Headers();
  headers.set("x-request-id", crypto.randomUUID());
  if (MUTATING.has(method) && csrfToken) {
    headers.set("x-csrf-token", csrfToken);
  }
  for (const [key, value] of Object.entries(options.headers ?? {})) {
    headers.set(key, value);
  }
  const init: RequestInit = {
    method,
    credentials: "include",
    headers,
  };
  if (options.body instanceof FormData) {
    init.body = options.body;
  } else if (options.body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError(0, "network", "Không kết nối được máy chủ", "");
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const message = typeof record.message === "string" ? record.message : "Lỗi hệ thống";
    const code = typeof record.code === "string" ? record.code : "internal_error";
    const requestId = typeof record.request_id === "string" ? record.request_id : "";
    if (response.status === 401) {
      csrfToken = "";
    }
    throw new ApiError(response.status, code, message, requestId, readDetails(record.details));
  }

  rememberCsrf(payload);
  return payload as T;
}

function rememberCsrf(payload: unknown): void {
  if (!payload || typeof payload !== "object" || !("csrf_token" in payload)) {
    return;
  }
  const value = (payload as { csrf_token?: unknown }).csrf_token;
  if (typeof value === "string" && value.length > 0) {
    csrfToken = value;
  }
}

export async function probe(path: string): Promise<"ok" | "unavailable" | "offline"> {
  try {
    const response = await fetch(path, { credentials: "include" });
    const payload = (await response.json().catch(() => null)) as { status?: string } | null;
    if (payload?.status === "ok") {
      return "ok";
    }
    if (response.status === 503 || payload?.status === "unavailable") {
      return "unavailable";
    }
    return "offline";
  } catch {
    return "offline";
  }
}

function readDetails(value: unknown): Record<string, string[]> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const details: Record<string, string[]> = {};
  for (const [key, messages] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(messages)) {
      continue;
    }
    const lines = messages.filter((item): item is string => typeof item === "string" && item.length > 0);
    if (lines.length > 0) {
      details[key] = lines;
    }
  }
  return Object.keys(details).length > 0 ? details : undefined;
}

export function fieldErrorsFrom(error: ApiError, known: string[]): { fields: Record<string, string>; extra: string | null } {
  const fields: Record<string, string> = {};
  const extra: string[] = [];
  for (const [key, messages] of Object.entries(error.details ?? {})) {
    const text = messages.join(" ");
    if (known.includes(key)) {
      fields[key] = text;
    } else {
      extra.push(text);
    }
  }
  return { fields, extra: extra.length > 0 ? extra.join(" ") : null };
}
