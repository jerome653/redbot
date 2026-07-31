/**
 * `redbot push`         — send everything the dashboard has not acknowledged
 * `redbot push status`  — what is configured, and how far each stream has got
 * `redbot push dry-run` — build and validate every batch, transmit nothing
 *
 * WHY A DRY RUN EXISTS. The receiving service currently answers `503 not_configured` on both
 * write paths — its secrets are pending approval — so until that lands there is no way to prove
 * a batch is well-formed by sending it. `dry-run` reads the database, applies the allow-list,
 * builds the envelopes and runs the forbidden-key check, without a network call. It is also the
 * safe thing to run first on an install that has never pushed, because a first run is a backfill.
 */
import { say } from '../log.js';
import { pushOnce, pushStatus, pushConfig, resolveToken, STREAMS } from '../push/index.js';
import { readPushState } from '../push/state.js';
import { PushClient } from '../push/client.js';

function reportLines(streams: { stream: string; sent: number; batches: number; stopped?: string }[]): void {
  for (const s of streams) {
    const n = `${s.sent}`.padStart(5);
    if (s.stopped) say.step(`${n}  ${s.stream.padEnd(18)} ${s.stopped}`);
    else if (s.sent) say.step(`${n}  ${s.stream.padEnd(18)} in ${s.batches} batch(es)`);
  }
}

async function status(): Promise<number> {
  say.head('redbot push — status');
  const st = pushStatus();
  const { baseUrl } = pushConfig();
  const tok = await resolveToken();

  say.step(`install    ${st.installId ?? '(not yet created)'}`);
  say.step(`machine    ${(await import('../machine.js')).machineId()}`);
  say.step(`endpoint   ${baseUrl ?? '(REDBOT_SYNC_URL is not set — pushing is off)'}`);
  /* The token is reported as present or absent and by SOURCE, never by value. */
  say.step(`token      ${tok.token ? `present, from ${tok.from}` : `absent — ${tok.note ?? 'none found'}`}`);
  say.step('');

  const state = readPushState();
  say.step('stream              acknowledged up to');
  for (const s of STREAMS) {
    const c = state.cursors[s.name];
    say.step(`  ${s.name.padEnd(18)}${c ? JSON.stringify(c) : '— nothing sent yet'}`);
  }

  if (baseUrl) {
    const health = await new PushClient({ baseUrl, token: tok.token ?? '' }).health();
    say.step('');
    say.step(`service    ${health.ok ? 'reachable' : 'NOT reachable'} — ${health.detail}`);
  }
  return 0;
}

/**
 * `redbot push accounts` — send this machine's account list.
 *
 * Uses the INGEST token, like every other write. Sends only when the list has actually changed,
 * because the whole list travels every time and an unchanged one is pure traffic.
 */
async function pushAccountsCmd(dryRun: boolean, force: boolean): Promise<number> {
  const { pushAccounts } = await import('../push/accounts.js');
  const { baseUrl } = pushConfig();
  const tok = await resolveToken();

  say.head(dryRun ? 'redbot push accounts — dry run' : 'redbot push accounts');

  if (!dryRun && !baseUrl) { say.fail('REDBOT_SYNC_URL is not set — pushing is off'); return 1; }
  if (!dryRun && !tok.token) { say.fail(`no push token — ${tok.note ?? 'none found'}`); return 1; }

  const client = dryRun || !baseUrl || !tok.token
    ? null
    : new PushClient({ baseUrl, token: tok.token });

  let r;
  try {
    r = await pushAccounts(client, { dryRun, force });
  } catch (e) {
    say.fail(e instanceof Error ? e.message : String(e));
    return 1;
  }

  say.step(`accounts     ${r.accounts}`);
  say.step(`listVersion  ${r.listVersion}`);
  if (r.skipped) { say.step(''); say.ok(r.skipped); return 0; }
  if (r.stopped) { say.step(''); say.warn(`not delivered — ${r.stopped}`); return 1; }
  say.step('');
  say.ok(`${r.accounts} account(s) sent as version ${r.listVersion}.`);
  return 0;
}

/**
 * `redbot pull accounts` — receive the shared list.
 *
 * Uses the SHARE token, which is a different token with different powers: an ingest token is
 * refused here by design. Shows the plan and, unless `--apply` is given, changes nothing.
 */
async function pullAccountsCmd(apply: boolean): Promise<number> {
  const { pullAccounts, applyAccounts } = await import('../push/accounts.js');
  const { readPushState, writePushState } = await import('../push/state.js');
  const { syncUrl, resolveShareToken } = await import('../push/index.js');
  const baseUrl = syncUrl();
  const share = await resolveShareToken();
  const token = share.token;

  say.head(apply ? 'redbot pull accounts — applying' : 'redbot pull accounts — plan only');

  if (!baseUrl) { say.fail('no dashboard endpoint — set it on the Setup screen or REDBOT_SYNC_URL'); return 1; }
  if (!token) {
    say.fail(`no share token — ${share.note ?? 'none found'}`);
    say.step('A share token is minted by whoever owns the accounts and is read-only.');
    say.step('Paste it on the Setup screen, or set REDBOT_SYNC_SHARE_TOKEN.');
    return 1;
  }

  const state = readPushState();
  const client = new PushClient({ baseUrl, token });
  const r = await pullAccounts(client, { etag: state.accountsEtag ?? null });

  if (r.notModified) { say.ok('unchanged since the last pull (304).'); return 0; }
  if (r.stopped) { say.warn(`could not read the list — ${r.stopped}`); return 1; }

  say.step(`listVersion  ${r.listVersion ?? '(none given)'}`);
  say.step('');
  for (const p of r.plan) {
    const detail = p.changed?.length ? ` (${p.changed.join(', ')})` : '';
    say.step(`  ${p.action.padEnd(10)} ${p.handle}${detail}`);
  }

  if (r.withdrawn.length) {
    say.step('');
    /* Never removed automatically. `accounts remove` already refuses an account with jobs or
       drafts unless confirmed, and sync must not be the one path around that guard. */
    say.warn(
      `${r.withdrawn.length} local account(s) are absent from the shared list: ` +
      `${r.withdrawn.join(', ')}. Nothing was removed — use \`redbot accounts remove <handle>\` ` +
      'if that is what you want.'
    );
  }

  const actionable = r.plan.filter((p) => p.action === 'create' || p.action === 'update');
  if (!apply) {
    say.step('');
    say.ok(`${actionable.length} account(s) would change. Re-run with --apply to write them.`);
    return 0;
  }
  if (!actionable.length) { say.step(''); say.ok('nothing to apply.'); return 0; }

  const applied = await applyAccounts(r.incoming, r.plan);
  say.step('');
  for (const e of applied.errors) say.warn(e);
  if (r.etag) writePushState({ ...state, accountsEtag: r.etag });
  say.ok(`${applied.applied} account(s) applied.`);
  say.step('Each still needs "Set it up" on this machine and a Reddit sign-in by hand —');
  say.step('a Chrome profile is bound to one machine and cannot be copied.');
  return applied.errors.length ? 1 : 0;
}

export async function pull(sub: string | undefined, opts: { apply?: boolean } = {}): Promise<number> {
  if (sub !== 'accounts') {
    say.fail('usage: redbot pull accounts [--apply]');
    return 1;
  }
  return pullAccountsCmd(opts.apply === true);
}

export async function push(
  sub: string | undefined,
  opts: { only?: string; batch?: string; force?: boolean } = {}
): Promise<number> {
  if (sub === 'status') return status();
  if (sub === 'accounts') return pushAccountsCmd(false, opts.force === true);
  if (sub === 'accounts-dry') return pushAccountsCmd(true, false);

  const dryRun = sub === 'dry-run' || sub === 'dry';
  const only = opts.only ? opts.only.split(',').map((s) => s.trim()).filter(Boolean) : undefined;

  if (only?.length) {
    const unknown = only.filter((n) => !STREAMS.some((s) => s.name === n));
    if (unknown.length) {
      say.fail(`unknown stream(s): ${unknown.join(', ')}`);
      say.step(`known: ${STREAMS.map((s) => s.name).join(', ')}`);
      return 1;
    }
  }

  const batchSize = opts.batch ? Number(opts.batch) : undefined;
  if (batchSize !== undefined && (!Number.isInteger(batchSize) || batchSize < 1)) {
    say.fail(`--batch must be a positive whole number, got ${opts.batch}`);
    return 1;
  }

  say.head(dryRun ? 'redbot push — dry run (nothing is transmitted)' : 'redbot push');

  let report;
  try {
    report = await pushOnce({
      dryRun,
      ...(only ? { only } : {}),
      ...(batchSize !== undefined ? { batchSize } : {})
    });
  } catch (e) {
    /* assertSendable throws here when the allow-list and the schema have diverged. That is a
       defect in this repository, not a transient failure, so it is loud and non-zero. */
    say.fail(e instanceof Error ? e.message : String(e));
    return 1;
  }

  say.step(`install ${report.installId}  ->  ${report.baseUrl}`);
  say.step('');
  reportLines(report.streams);

  if (report.fatal) {
    say.step('');
    say.fail(report.fatal);
    return 1;
  }

  say.step('');
  if (dryRun) {
    const built = report.streams.reduce((n, s) => n + s.sent, 0);
    say.ok(`${built} event(s) built and validated. Nothing was sent.`);
    return 0;
  }

  /**
   * A stream that STOPPED had events the server would not take. Reporting that as "nothing new to
   * send" says the opposite of what happened — the first version of this command did, against a
   * live `503`, and it read as success. Undelivered is not success, so it is named and the exit
   * code is non-zero: a scheduled push that silently reports OK while the dashboard receives
   * nothing is the failure this whole design is meant to make visible.
   */
  const blocked = report.streams.filter((s) => s.stopped);
  if (blocked.length) {
    if (report.sent) say.ok(`${report.sent} event(s) sent.`);
    say.warn(
      `${blocked.length} stream(s) could not deliver — ${blocked.map((s) => s.stream).join(', ')}. ` +
      'Cursors are unchanged, so nothing is lost; the next run retries.'
    );
    return 1;
  }

  say.ok(report.sent === 0 ? 'nothing new to send.' : `${report.sent} event(s) sent.`);
  return 0;
}
