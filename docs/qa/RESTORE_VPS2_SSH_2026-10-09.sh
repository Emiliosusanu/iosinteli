#!/bin/sh
# Run in the terminal ON VPS2, as the account you want to use for SSH.
# Adds only the tester public key; preserves existing keys, Chrome and sessions.
set -eu
umask 077
mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
touch "$HOME/.ssh/authorized_keys"
cp -p "$HOME/.ssh/authorized_keys" "$HOME/.ssh/authorized_keys.before-inteliads-$(date +%Y%m%d-%H%M%S)"
inteliads_qa_key='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJmVJuRVRa1nHBALNFWX43EAjYQnCY5vSUJe6VTgCS0P emiliano@mac'
if ! grep -Fqx -- "$inteliads_qa_key" "$HOME/.ssh/authorized_keys"; then
  printf '\n%s\n' "$inteliads_qa_key" >> "$HOME/.ssh/authorized_keys"
fi
chmod 600 "$HOME/.ssh/authorized_keys"
whoami
hostname -I
