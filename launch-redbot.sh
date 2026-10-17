#!/usr/bin/env bash
# The vault key used to sit in this file on an `export` line, in a script that is
# mode 0775 -- readable by anyone who can reach the project. It now lives in
# vault.env (0640, root:kumo, +ACL for the operator) and is sourced here, so the
# secret is not carried by a world-readable file. 2026-09-01.
set -a
[ -r /srv/projects/redbot/vault.env ] && . /srv/projects/redbot/vault.env
set +a
export PATH=/opt/node24/bin:$PATH
cd /srv/projects/redbot && exec npm start
