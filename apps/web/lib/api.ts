export class ApiError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string };
  data?: unknown;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", ...init });
  const type = res.headers.get("content-type") ?? "";
  const body: ErrorBody | null = type.includes("application/json") ? ((await res.json()) as ErrorBody) : null;

  if (!res.ok) {
    throw new ApiError(
      body?.error?.message ?? res.statusText,
      body?.error?.code ?? String(res.status),
      res.status,
    );
  }
  return (body?.data ?? body) as T;
}

export function jsonInit(method: string, data: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(data) };
}

export function errMessage(e: unknown): string {
  if (e instanceof ApiError) return `${e.code}: ${e.message}`;
  if (e instanceof Error) return e.message;
  return "Terjadi kesalahan";
}
