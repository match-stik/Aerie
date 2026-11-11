#!/bin/sh
# Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
# Run once, by them, with sudo: sudo sh ~/aerie/tools/claude-code-updater/install.sh
# It puts the updater where only root can change it and lets the house account
# run that one file as root without a password, so Settings can update Claude
# Code and roll it back. Nothing else gains root.
#
# To undo: sudo rm /etc/sudoers.d/zz-aerie-claude-code /usr/local/sbin/aerie-update-claude-code
#
# The permission file is named to load LAST. sudo uses the last rule that
# matches, so a plain '(ALL) ALL' line for this account in any file that loads
# after ours puts the password back on the updater (seen on this box Nov 10
# 2026: the first name, aerie-claude-code, loaded before one of those).
set -eu
if [ "$(id -u)" != "0" ]; then
  echo "Run it with sudo: sudo sh $0" >&2
  exit 1
fi
who="${SUDO_USER:-}"
if [ -z "$who" ] || [ "$who" = "root" ]; then
  echo "Run it with sudo from your own account, not as root directly." >&2
  exit 1
fi
here="$(cd "$(dirname "$0")" && pwd)"
install -o root -g root -m 0755 "$here/aerie-update-claude-code" /usr/local/sbin/aerie-update-claude-code
tmp="$(mktemp)"
printf '%s ALL=(root) NOPASSWD: /usr/local/sbin/aerie-update-claude-code\n' "$who" > "$tmp"
if ! visudo -cf "$tmp" >/dev/null; then
  rm -f "$tmp"
  echo "The permission line did not check out, so nothing was changed in sudoers." >&2
  exit 1
fi
install -o root -g root -m 0440 "$tmp" /etc/sudoers.d/zz-aerie-claude-code
rm -f "$tmp" /etc/sudoers.d/aerie-claude-code
# Prove it: run the updater with no version as the house account. It answers
# 2 (no version given) when sudo let it through, and sudo answers 1 when it
# still wants a password.
set +e
sudo -n -u "$who" sudo -n /usr/local/sbin/aerie-update-claude-code >/dev/null 2>&1
got=$?
set -e
if [ "$got" != "2" ]; then
  echo "The permission is in place but sudo still asks for a password for the updater. Another sudoers rule wins over it; nothing else was changed." >&2
  exit 1
fi
echo "Done. Settings > Data can now update Claude Code."
