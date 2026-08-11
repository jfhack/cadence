#!/usr/bin/env bash
# one-shot setup for the optional Caddy + Authelia overlay.
#
#   scripts/init-auth.sh                 # prompts for the first user
#   scripts/init-auth.sh alice alice@example.com
#
# generates the three secrets Authelia needs into .env (only the missing
# ones; it never overwrites what is already there) and writes
# deploy/authelia/users.yml with an argon2id hash of the password.
#
# re-run it later to add another user; existing ones are kept.

set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=.env
USERS_FILE=deploy/authelia/users.yml
AUTHELIA_IMAGE=authelia/authelia:4

[[ -f "$ENV_FILE" ]] || { echo "No .env yet. Copy .env.example to .env first."; exit 1; }

# --- secrets ----------------------------------------------------------------

random_secret() { openssl rand -hex 32; }

add_secret_if_missing() {
    local key="$1"
    if grep -qE "^${key}=.+" "$ENV_FILE"; then
        echo "  ${key}: already set, left alone"
        return
    fi
    # replace an empty placeholder if present, otherwise append.
    if grep -qE "^${key}=$" "$ENV_FILE"; then
        sed -i "s|^${key}=$|${key}=$(random_secret)|" "$ENV_FILE"
    else
        printf '%s=%s\n' "$key" "$(random_secret)" >> "$ENV_FILE"
    fi
    echo "  ${key}: generated"
}

echo "Secrets:"
add_secret_if_missing AUTHELIA_SESSION_SECRET
add_secret_if_missing AUTHELIA_STORAGE_ENCRYPTION_KEY
add_secret_if_missing AUTHELIA_JWT_SECRET

# --- first user -------------------------------------------------------------

username="${1:-}"
email="${2:-}"
[[ -n "$username" ]] || read -rp "Username: " username
[[ -n "$email" ]] || read -rp "Email: " email

read -rsp "Password (not echoed): " password; echo
read -rsp "Repeat password: " password_repeat; echo
[[ "$password" == "$password_repeat" ]] || { echo "Passwords do not match."; exit 1; }
(( ${#password} >= 12 )) || { echo "Use at least 12 characters. This is the only thing in front of your API keys."; exit 1; }

echo "Hashing (argon2id, deliberately slow)…"
hash=$(docker run --rm "$AUTHELIA_IMAGE" \
    authelia crypto hash generate argon2 --password "$password" \
    | sed -n 's/^Digest: //p')
[[ -n "$hash" ]] || { echo "Could not generate the hash."; exit 1; }

if [[ ! -f "$USERS_FILE" ]]; then
    printf -- '---\nusers:\n' > "$USERS_FILE"
fi

if grep -qE "^  ${username}:" "$USERS_FILE"; then
    echo "User '${username}' already exists in ${USERS_FILE}; edit it by hand to change the hash."
    exit 1
fi

cat >> "$USERS_FILE" <<YAML
  ${username}:
    disabled: false
    displayname: '${username}'
    password: '${hash}'
    email: '${email}'
    groups:
      - 'users'
YAML

chmod 600 "$USERS_FILE"
echo
echo "Wrote ${USERS_FILE} (user: ${username})"
echo
echo "Next:"
echo "  1. Set CADENCE_DOMAIN and AUTH_DOMAIN in .env, and point both at this host in DNS."
echo "  2. Start the stack:"
echo "       scripts/stack.sh start --caddy      # includes Caddy, gets TLS for you"
echo "       scripts/stack.sh start              # Authelia only, behind your own proxy"
echo "       scripts/stack.sh start --no-ports   # same, but nothing published on the host:"
echo "                                           # for a proxy on a shared docker network"
echo
echo "Re-running this script while the stack is up is fine: Authelia watches"
echo "${USERS_FILE} and picks up new users without a restart."
