/**
 * One-click "Add account": type the Reddit username, press one button, and everything that is
 * clerical runs on its own.
 *
 *   create  → the account record, a free debug port and its own browser folder
 *   persona → a voice no other account has (src/persona-allocate.ts), never overwriting one
 *   open    → that account's Chrome, on the Reddit sign-in page
 *   signin  → WAIT. The person signs in by hand; this polls until the browser names the account
 *   karma   → the existing `check-karma` action, so Today has a measured number
 *
 * WHY IT LIVES IN THE SERVER AND NOT IN THE DIALOG. Signing in takes minutes, and a dialog is the
 * thing most likely to be closed in those minutes. The flow is held here, keyed by handle, so
 * closing the dialog loses nothing: reopening it (or pressing the button again) finds the run
 * where it is. The screen only polls `get()`.
 *
 * RESUME, NOT RESTART. A failed step is retried from where it failed. Steps already done are
 * skipped, and `create` additionally asks the record whether the account exists, so a server
 * restarted mid-flow does not try to create an account twice either.
 *
 * WHAT IS NEVER AUTOMATED: the sign-in. Nothing here types, reads or stores a password. The
 * `signin` step only asks the browser who it is signed in as.
 *
 * Every side effect is injected (`deps`), which is what lets add-account-flow.test.mjs drive the
 * whole thing with a fake clock and no browser.
 */

export const STEP_KEYS = ['create', 'persona', 'open', 'signin', 'karma'];

const LABELS = {
  create: 'Set the account up',
  persona: 'Give it a voice',
  open: 'Open its Chrome on the Reddit sign-in page',
  signin: 'Sign in to Reddit in the Chrome window that just opened',
  karma: 'Check its karma'
};

/** Consecutive unreadable browsers before the wait gives up — a closed window is not worth ten minutes. */
const MAX_READ_ERRORS = 3;

const msg = (e) => (e && e.message ? e.message : String(e));

/** "u/name", "/u/name" and stray spaces are how a name gets copied off Reddit. */
export function cleanHandle(raw) {
  return String(raw ?? '').trim().replace(/^\/?u\//i, '').trim();
}

/**
 * The karma figure in a `probe-karma` run's output, or null.
 *
 * Its own "recorded: karma N" line first — printed only once the number is in the observation
 * store, so it is the figure the rest of redbot will read — then the JSON it prints above that.
 */
export function karmaFromOutput(out) {
  const text = String(out ?? '');
  const m = /recorded: karma (-?[\d,.]+)/i.exec(text) || /"karma"\s*:\s*"?(-?[\d,.]+)/i.exec(text);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * @param deps {{
 *   exists(handle): Promise<boolean>,
 *   create(input): Promise<{ok:boolean,error?:string,account?:object,adoptedProfileDir?:boolean}>,
 *   persona(handle): Promise<{ok:boolean,error?:string,note?:string}>,
 *   open(handle): Promise<{ok:boolean,error?:string}>,
 *   signedInAs(handle): Promise<{loggedIn:boolean,username:string|null}>,
 *   checkKarma(handle): Promise<{ok:boolean,error?:string,karma?:number|null}>,
 *   sleep?(ms): Promise<void>, now?(): number, onDone?(state): void
 * }}
 */
export function createAddAccountFlows(deps, { pollMs = 5000, timeoutMs = 10 * 60 * 1000 } = {}) {
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = deps.now || (() => Date.now());
  /** handle (lower-cased) → { state, finished } */
  const flows = new Map();

  /* What leaves this module: a copy, without the request body it was started from. */
  const snapshot = (s) => {
    const out = JSON.parse(JSON.stringify(s));
    delete out.input;
    return out;
  };

  function fresh(input) {
    return {
      handle: input.handle,
      input,
      status: 'running',
      failedStep: null,
      error: null,
      karma: null,
      message: null,
      startedAt: now(),
      steps: STEP_KEYS.map((key) => ({ key, label: LABELS[key], state: 'pending', detail: null }))
    };
  }

  const step = (s, key) => s.steps.find((x) => x.key === key);

  /* ---- the steps. Each returns { ok, detail?, error?, warn? }; none throws past `run`. ---- */

  const doers = {
    async create(s) {
      if (await deps.exists(s.handle)) return { ok: true, detail: `${s.handle} is already set up — not created again` };
      const r = await deps.create(s.input);
      if (!r || !r.ok) return { ok: false, error: (r && r.error) || 'the account could not be set up' };
      const a = r.account || {};
      return {
        ok: true,
        detail: r.adoptedProfileDir
          ? `got its old browser folder ${a.profileDir} back, on port ${a.debugPort}`
          : (a.profileDir ? `browser folder ${a.profileDir}, port ${a.debugPort}` : null)
      };
    },

    async persona(s) {
      let r;
      try { r = await deps.persona(s.handle); } catch (e) { r = { ok: false, error: msg(e) }; }
      /* A voice is an improvement, not a precondition: an account without one drafts in the
         default voice, and blocking the sign-in over it would be the wrong trade. Warned. */
      if (!r || !r.ok) return { ok: true, warn: true, detail: `no voice assigned: ${(r && r.error) || 'unknown reason'} — set one on the Accounts screen` };
      return { ok: true, detail: r.note || null };
    },

    async open(s) {
      const r = await deps.open(s.handle);
      if (!r || !r.ok) return { ok: false, error: (r && r.error) || 'Chrome did not open' };
      return { ok: true, detail: r.alreadyRunning ? 'its Chrome was already open' : null };
    },

    async signin(s, st) {
      const started = now();
      let errors = 0;
      for (;;) {
        let who = null;
        try {
          who = await deps.signedInAs(s.handle);
          errors = 0;
        } catch (e) {
          errors++;
          st.detail = `could not read the browser: ${msg(e)}`;
          if (errors >= MAX_READ_ERRORS) {
            return { ok: false, error: `Could not read ${s.handle}'s browser: ${msg(e)}. Is its Chrome window still open? Press Try again to reopen the check.` };
          }
        }
        if (who && who.username) {
          if (who.username.toLowerCase() === s.handle.toLowerCase()) {
            return { ok: true, detail: `signed in as ${who.username}` };
          }
          return {
            ok: false,
            error: `That Chrome window is signed in as ${who.username}, not ${s.handle}. Sign out there, sign in as ${s.handle}, then press Try again.`
          };
        }
        if (who) st.detail = who.loggedIn ? 'signed in — reading which account…' : 'waiting for you to sign in…';

        const waited = now() - started;
        if (waited >= timeoutMs) {
          const mins = Math.round(timeoutMs / 60000);
          return {
            ok: false,
            error: `No sign-in as ${s.handle} after ${mins} minutes. Sign in to Reddit in that Chrome window, then press Try again.`
          };
        }
        await sleep(Math.min(pollMs, Math.max(0, timeoutMs - waited)) || pollMs);
      }
    },

    async karma(s) {
      const r = await deps.checkKarma(s.handle);
      if (!r || !r.ok) return { ok: false, error: (r && r.error) || 'the karma check did not work' };
      s.karma = Number.isFinite(r.karma) ? r.karma : null;
      return { ok: true, detail: s.karma == null ? 'karma could not be read yet' : `karma ${s.karma}` };
    }
  };

  async function run(s) {
    for (const key of STEP_KEYS) {
      const st = step(s, key);
      if (st.state === 'done' || st.state === 'warn') continue;   // resume: never redo a finished step
      st.state = 'running';
      st.detail = null;
      let r;
      try {
        r = await doers[key](s, st);
      } catch (e) {
        r = { ok: false, error: msg(e) };
      }
      if (!r.ok) {
        st.state = 'failed';
        st.detail = r.error;
        s.status = 'failed';
        s.failedStep = key;
        s.error = r.error;
        return s;
      }
      st.state = r.warn ? 'warn' : 'done';
      st.detail = r.detail ?? null;
    }
    s.status = 'done';
    s.message = s.karma == null ? `Added — ${s.handle} (karma not read yet)` : `Added — ${s.handle}, karma ${s.karma}`;
    try { deps.onDone && deps.onDone(snapshot(s)); } catch { /* a listener must not fail the flow */ }
    return s;
  }

  return {
    /**
     * Start a flow, resume a failed one, or hand back the one already running.
     * Returns `{ ok, state, finished }`; `finished` resolves with the final state (a snapshot).
     */
    start(input) {
      const handle = cleanHandle(input && input.handle);
      if (!handle) {
        const s = { handle: '', status: 'failed', failedStep: 'create', error: 'Type the Reddit username first.', steps: [] };
        return { ok: false, state: s, finished: Promise.resolve(s) };
      }
      const key = handle.toLowerCase();
      const have = flows.get(key);
      if (have && have.state.status === 'running') {
        return { ok: true, state: snapshot(have.state), finished: have.finished };
      }
      let s;
      /* A finished flow is not resumed but run again from the top — the account may have been
         removed and re-added since. Each step is idempotent: create sees the record, open finds
         the window already open, and only the karma figure is measured fresh. */
      if (have && have.state.status === 'failed') {
        /* RESUME from the failed step. Fresh optional fields win if the person filled them in. */
        s = have.state;
        s.input = { ...s.input, ...input, handle: s.handle };
        s.status = 'running'; s.failedStep = null; s.error = null;
        for (const st of s.steps) if (st.state === 'failed') { st.state = 'pending'; st.detail = null; }
      } else {
        s = fresh({ ...input, handle });
      }
      const finished = run(s).then(snapshot);
      flows.set(key, { state: s, finished });
      return { ok: true, state: snapshot(s), finished };
    },

    /** The flow for a handle, or null. Case-insensitive. */
    get(handle) {
      const f = flows.get(cleanHandle(handle).toLowerCase());
      if (!f) return null;
      return snapshot(f.state);
    },

    /** Every flow this process holds, newest first. */
    all() {
      return [...flows.values()].map((f) => snapshot(f.state)).sort((a, b) => b.startedAt - a.startedAt);
    }
  };
}
