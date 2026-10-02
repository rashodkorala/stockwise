const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export async function fetchText(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<string> {
  const { timeoutMs = 20_000, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers: { "User-Agent": BROWSER_UA, ...headers },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (err) {
    throw new HttpError(`Request to ${new URL(url).host} failed: ${(err as Error).message}`);
  }
  if (!res.ok) throw new HttpError(`${new URL(url).host} answered ${res.status}`, res.status);
  return res.text();
}

export async function fetchJson<T>(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const text = await fetchText(url, init);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(`${new URL(url).host} did not return JSON`);
  }
}

// SEC asks for at most 10 requests per second and a User-Agent naming a contact.
const SEC_MIN_GAP_MS = 125;
let secQueue: Promise<void> = Promise.resolve();

function secUserAgent(): string {
  return process.env.SEC_USER_AGENT || "Stockwise research app (set SEC_USER_AGENT to name and email)";
}

export function fetchSec(url: string, timeoutMs = 30_000): Promise<string> {
  const turn = secQueue.then(() => new Promise<void>((r) => setTimeout(r, SEC_MIN_GAP_MS)));
  secQueue = turn;
  return turn.then(() =>
    fetchText(url, { timeoutMs, headers: { "User-Agent": secUserAgent(), "Accept-Encoding": "gzip, deflate" } }),
  );
}
