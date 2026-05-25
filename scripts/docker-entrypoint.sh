#!/bin/sh
# Pressh container entrypoint — secure-by-default secret provisioning.
#
# If PRESSH_MASTER_KEY / PRESSH_CSRF_SECRET are not supplied by the operator,
# generate them ONCE on first boot and persist them to the shared data volume
# (0600). They then stay stable across restarts and are identical for the site
# and studio processes (which mount the same /data). Secrets never enter the
# image or CI logs. An operator-supplied value always overrides the generated one.
set -eu

SECRETS_DIR="${PRESSH_SECRETS_DIR:-/data/secrets}"

ensure_secret() {
  var_name="$1"
  file_name="$2"

  # An operator-supplied value always wins — do not generate or persist.
  if [ -n "$(printenv "$var_name" 2>/dev/null || true)" ]; then
    return 0
  fi

  if ! mkdir -p "$SECRETS_DIR" 2>/dev/null; then
    echo "pressh: cannot create $SECRETS_DIR to persist $var_name — mount a writable /data volume or supply $var_name as a secret." >&2
    exit 1
  fi
  chmod 700 "$SECRETS_DIR" 2>/dev/null || true

  secret_file="$SECRETS_DIR/$file_name"
  if [ ! -f "$secret_file" ]; then
    tmp_file="$(mktemp "$SECRETS_DIR/.${file_name}.XXXXXX")"
    node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" > "$tmp_file"
    chmod 600 "$tmp_file"
    # Atomic publish via hard link: if a sibling process won the race the link
    # fails and we fall through to read whichever value landed first.
    ln "$tmp_file" "$secret_file" 2>/dev/null || true
    rm -f "$tmp_file"
  fi

  export "$var_name=$(cat "$secret_file")"
}

ensure_secret PRESSH_MASTER_KEY master.key
ensure_secret PRESSH_CSRF_SECRET csrf.key

exec "$@"
