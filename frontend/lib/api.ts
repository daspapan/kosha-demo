// One small wrapper around fetch for the Kosha backend.

export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type Options = { method?: "GET" | "POST"; body?: unknown; form?: FormData; token?: string | null };

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  let body: BodyInit | undefined;
  if (options.form) body = options.form;
  else if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  let res: Response;
  try {
    res = await fetch(API_URL + "/api" + path, { method: options.method ?? "GET", headers, body });
  } catch {
    throw new ApiError("Cannot reach the Kosha backend. Start it with npm run dev.", 0);
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

/** For SWR: the key is the path, the token comes along when signed in. */
export const fetcher = <T,>([path, token]: [string, string | null]) => api<T>(path, { token });
