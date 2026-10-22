#!/usr/bin/env bash
# The vault key used to sit in this file on an `export` line, in a script that is
# mode 0775 -- readable by anyone who can reach the project. It now lives in
# vault.env (0640, root:kumo, +ACL for the operator) and is sourced here, so the
# secret is not carried by a world-readable file. 2026-09-01.
set -a
[ -r /srv/projects/redbot/vault.env ] && . /srv/projects/redbot/vault.env
set +a
export PATH=/opt/node24/bin:$PATH
cd /srv/projects/redbot || exit 1
# `npm start` is `tsc && electron .`: a full compile on every launch, ~12 s on cardinal (measured
# 21 Oct: npm start 18:52:38 -> electron 18:52:50) even when nothing changed since the last one.
# Compile only when a source file is newer than the build; a deploy's checkout touches src, so a
# new commit still compiles before it runs. 2026-10-22.
if [ ! -f dist/cli.js ] || [ -n "$(find src tsconfig.json package.json -newer dist/cli.js -print -quit)" ]; then
  ./node_modules/.bin/tsc || exit 1
fi
exec ./node_modules/.bin/electron .
