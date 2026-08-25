#!/bin/sh
# Prove the US exit is what it claims to be — run this ON the US machine, after tinyproxy starts.
#
# ---------------------------------------------------------------------------
# THE ONE CHECK THIS EXISTS FOR
#
# An HTTP proxy with no working authentication, bound to anything wider than the tailnet, is an
# OPEN PROXY on somebody's home internet connection. Strangers browse as that household; the
# household's address is the one that gets abuse-listed. It is the worst outcome available in
# this whole design, it is silent, and it looks identical to success from our side — the exit
# works fine either way.
#
# So check 2 below is not a formality. If an unauthenticated request comes back with a page
# instead of a 407, STOP. Do not sign an account in, do not leave the daemon running.
#
# That check is also why this script exists rather than a `redbot` subcommand: it has to run on
# the host's machine, and the host does not have redbot.
#
# ---------------------------------------------------------------------------
# CREDENTIALS NEVER APPEAR IN A COMMAND LINE
#
# `-x http://user:pass@host:port` would put the password in the process list, where any other
# user on the machine can read it, and in this shell's history. Same rule the CLI states: "a
# password in a command line lands in your shell history and in the process list."
#
# So the password comes from the environment, and reaches curl through a config file on stdin
# (`curl -K -`), which is the one path that is neither argv nor a file left on disk.
#
# Usage:
#   REDBOT_PROXY_PASS='...' sh verify-exit.sh [host] [port] [user]
#   defaults: host=127.0.0.1  port=8888  user=redbot
#
# Exits 0 only if every check passed. Any failure exits non-zero and says what to do.

set -eu

HOST="${1:-127.0.0.1}"
PORT="${2:-8888}"
USER_NAME="${3:-redbot}"
PROXY="http://$HOST:$PORT"

# A tiny endpoint that answers with the caller's address and nothing else.
WHOAMI='https://api.ipify.org'
PLAIN='http://example.com/'

fail=0
say()  { printf '%s\n' "$*"; }
ok()   { printf '  PASS  %s\n' "$*"; }
bad()  { printf '  FAIL  %s\n' "$*"; fail=1; }
warn() { printf '  WARN  %s\n' "$*"; }

if [ -z "${REDBOT_PROXY_PASS:-}" ]; then
  say 'REDBOT_PROXY_PASS is not set. Set it in the environment, not as an argument:'
  say "  REDBOT_PROXY_PASS='...' sh $0 $HOST $PORT $USER_NAME"
  exit 2
fi

# curl, reading its credentials from stdin so they never enter argv.
with_auth() {
  printf 'proxy-user = "%s:%s"\n' "$USER_NAME" "$REDBOT_PROXY_PASS" | curl -K - "$@"
}

say ''
say "Checking the exit at $PROXY"
say ''

# ---------------------------------------------------------------------------
say '1. What this machine looks like without the proxy'
DIRECT="$(curl -fsS --max-time 20 "$WHOAMI" 2>/dev/null || true)"
if [ -n "$DIRECT" ]; then
  ok "this household's public address is $DIRECT"
else
  bad 'could not reach the internet directly — nothing below will mean anything. Check the network.'
  exit 1
fi

# ---------------------------------------------------------------------------
# THE CHECK THAT MATTERS. A plain GET, not a CONNECT, so the proxy answers with a real status
# code rather than a tunnel that simply fails to open.
say ''
say '2. An UNAUTHENTICATED request must be refused'
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -x "$PROXY" "$PLAIN" 2>/dev/null || echo 000)"
case "$CODE" in
  407)
    ok 'refused with 407, which is correct — authentication is on'
    ;;
  000)
    bad "no answer at all from $PROXY. Is tinyproxy running, and is Listen set to an address this machine has?"
    ;;
  *)
    say ''
    say '  ################################################################'
    say "  #  OPEN PROXY. An anonymous request was answered with $CODE.    "
    say '  #  Anyone who can reach this port browses as this household.   '
    say '  #  STOP HERE. Fix BasicAuth, or replace tinyproxy with 3proxy. '
    say '  ################################################################'
    fail=1
    ;;
esac

# ---------------------------------------------------------------------------
say ''
say '3. An AUTHENTICATED request must succeed'
CODE="$(with_auth -s -o /dev/null -w '%{http_code}' --max-time 20 -x "$PROXY" "$PLAIN" 2>/dev/null || echo 000)"
if [ "$CODE" = '200' ]; then
  ok 'the stored credential is accepted'
elif [ "$CODE" = '407' ]; then
  bad 'the credential was REJECTED. The BasicAuth line and this password disagree — check the syntax the installed version wants (space-separated vs colon).'
else
  bad "unexpected status $CODE on an authenticated request"
fi

# ---------------------------------------------------------------------------
# CONNECT is the path that carries everything real: Chrome sends it for every https:// origin.
say ''
say '4. HTTPS through the proxy, and where it comes out'
THROUGH="$(with_auth -fsS --max-time 25 -x "$PROXY" "$WHOAMI" 2>/dev/null || true)"
if [ -z "$THROUGH" ]; then
  bad 'CONNECT failed — https does not pass. Check that ConnectPort includes 443.'
elif [ "$THROUGH" = "$DIRECT" ]; then
  ok "exits from $THROUGH — the same address as this machine, which is what we want"
else
  bad "exits from $THROUGH but this machine is $DIRECT. Traffic is leaving somewhere else — a VPN on this machine, or an upstream proxy in the config."
fi

# ---------------------------------------------------------------------------
# Best effort: the binding. Not every machine has ss or netstat, so a miss here is a WARN.
say ''
say '5. What address the daemon is bound to'
BOUND=''
if command -v ss >/dev/null 2>&1; then
  BOUND="$(ss -ltn 2>/dev/null | grep -E "[:.]$PORT([^0-9]|$)" || true)"
elif command -v netstat >/dev/null 2>&1; then
  BOUND="$(netstat -an 2>/dev/null | grep -E "[:.]$PORT([^0-9]|$)" | grep -i listen || true)"
fi
if [ -z "$BOUND" ]; then
  warn "could not read the listening sockets on this machine — confirm by hand that Listen is the tailnet address, not 0.0.0.0"
elif printf '%s' "$BOUND" | grep -qE '(0\.0\.0\.0|\[::\]|\*):'"$PORT"; then
  bad "bound to a WILDCARD address. Every device on this network can use it. Set Listen to this machine's tailnet address (tailscale ip -4)."
else
  ok 'bound to a specific address, not the wildcard'
  printf '        %s\n' "$BOUND"
fi

# ---------------------------------------------------------------------------
say ''
if [ "$fail" -eq 0 ]; then
  say 'All checks passed. The exit is private, authenticated, and comes out of this household.'
  say ''
  say 'Next, on the operator machine:  node tools/exit/verify-exit.mjs'
  exit 0
fi
say 'Something above failed. Do not sign any account in through this exit until it is fixed.'
exit 1
