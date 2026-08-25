/**
 * Webshare, as the Setup screen uses it — list this account's US proxies so the exit form can be
 * auto-filled instead of typed by hand.
 *
 * This is a CONVENIENCE, not part of any run path. Nothing here signs an account in, opens a
 * browser, or decides an exit; it turns a stored API key into a list of candidate addresses the
 * operator still has to run through the same six-hour vet as a hand-typed one. No exit vendor is
 * chosen yet — PROXY-VENDOR-DECISION.md holds the comparison and recommends Proxy-Cheap static
 * residential. A Webshare key is a shortcut for whoever already has one, and its cheap pool is
 * datacenter-classified, which the vet is there to catch.
 *
 * The API is documented at https://apidocs.webshare.io — `GET /api/v2/proxy/list/` returns, per
 * proxy: id, username, password, proxy_address, port, valid, last_verification, country_code,
 * city_name, asn_name. Auth is a header, `Authorization: Token <key>`. The key travels only in
 * that header and is never put in a thrown message, exactly as src/vault.ts requires of a secret.
 */
import { usZoneForCity } from './align.js';

const API_BASE = 'https://proxy.webshare.io/api/v2';

/** One US proxy, enriched with the timezone its city implies. The console fills the exit form from this. */
export interface WebshareProxy {
  id: string;
  host: string;
  port: number;
  username: string;
  password: string;
  country: string | null;
  city: string | null;
  asn: string | null;
  valid: boolean;
  lastVerification: string | null;
  /** Suggested IANA account timezone for this exit's city, or null when the city is unknown/ambiguous. */
  timezone: string | null;
}

/** Only the fields this module reads — Webshare returns more, and ignoring the rest is deliberate. */
interface WebshareListItem {
  id?: string | number;
  username?: string;
  password?: string;
  proxy_address?: string;
  port?: number;
  valid?: boolean;
  last_verification?: string | null;
  country_code?: string | null;
  city_name?: string | null;
  asn_name?: string | null;
}

interface WebshareListResponse {
  count?: number;
  next?: string | null;
  previous?: string | null;
  results?: WebshareListItem[];
}

export interface FetchOptions {
  timeoutMs?: number;
  /** Injectable so a test drives this without a network. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * The account's US proxies, newest verification data first as Webshare orders them.
 *
 * Follows `next` so a plan with more than one page is fully listed, capped at 20 pages as a
 * runaway guard (2000 proxies — far past anything redbot has any use for). `mode=direct` is
 * REQUIRED by the API; `country_code__in=US` is the filter, and the per-item country is re-checked
 * defensively so a change in the filter's meaning cannot quietly admit a non-US exit.
 *
 * Throws on an unreachable host, a rejected key, or a non-JSON body — each named so the Setup
 * screen can say which, and none of them echoing the key.
 */
export async function fetchUsProxies(apiKey: string, opts: FetchOptions = {}): Promise<WebshareProxy[]> {
  const key = (apiKey ?? '').trim();
  if (!key) throw new Error('No Webshare API key was given.');

  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 15_000;

  const out: WebshareProxy[] = [];
  let url: string | null = `${API_BASE}/proxy/list/?mode=direct&country_code__in=US&page_size=100`;
  let pages = 0;

  while (url && pages < 20) {
    pages++;

    let res: Response;
    try {
      res = await doFetch(url, {
        headers: { Authorization: `Token ${key}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (e) {
      throw new Error(`Could not reach Webshare (${e instanceof Error ? e.message : String(e)}).`);
    }

    if (!res.ok) {
      // The body may carry a `detail` — safe to surface, it never contains the key (the key is a
      // request header). A bad key comes back 401/403; say so in words an operator can act on.
      let detail = '';
      try {
        const j = (await res.json()) as { detail?: string; error?: string };
        const d = j && (j.detail || j.error);
        if (d) detail = ` — ${d}`;
      } catch { /* a non-JSON error body carries nothing worth surfacing */ }

      if (res.status === 401 || res.status === 403) {
        throw new Error(`Webshare rejected the API key (HTTP ${res.status})${detail}. Re-check the key on the Setup screen.`);
      }
      throw new Error(`Webshare returned HTTP ${res.status}${detail}.`);
    }

    let page: WebshareListResponse;
    try {
      page = (await res.json()) as WebshareListResponse;
    } catch (e) {
      throw new Error(`Webshare sent a response that was not JSON (${e instanceof Error ? e.message : String(e)}).`);
    }

    for (const r of page.results ?? []) {
      if (!r || !r.proxy_address || !r.port) continue;
      const country = r.country_code ? String(r.country_code) : null;
      if (country && country.toUpperCase() !== 'US') continue;
      out.push({
        id: String(r.id ?? `${r.proxy_address}:${r.port}`),
        host: String(r.proxy_address),
        port: Number(r.port),
        username: typeof r.username === 'string' ? r.username : '',
        password: typeof r.password === 'string' ? r.password : '',
        country,
        city: r.city_name ? String(r.city_name) : null,
        asn: r.asn_name ? String(r.asn_name) : null,
        valid: Boolean(r.valid),
        lastVerification: r.last_verification ? String(r.last_verification) : null,
        timezone: usZoneForCity(r.city_name)
      });
    }

    url = typeof page.next === 'string' && page.next ? page.next : null;
  }

  return out;
}
