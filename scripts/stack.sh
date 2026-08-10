#!/usr/bin/env bash
# start and stop the production stack without typing the -f chain by hand.
#
#   scripts/stack.sh start              # app + Authelia (your own proxy in front)
#   scripts/stack.sh start --caddy      # app + Authelia + bundled Caddy (TLS included)
#   scripts/stack.sh start --plain      # app only, no login
#   scripts/stack.sh start --no-ports   # do not publish on the host, share a docker network
#   scripts/stack.sh start --build      # rebuild the images first
#   scripts/stack.sh stop               # remove the containers, keep the data
#   scripts/stack.sh restart
#   scripts/stack.sh status
#   scripts/stack.sh logs [service]
#   scripts/stack.sh reset              # also delete the volumes, asks first
#
# flags combine, e.g. `start --caddy --build`.

set -euo pipefail
cd "$(dirname "$0")/.."

FILES=(-f docker-compose.yml)
WITH_AUTH=1
WITH_CADDY=0
NO_PORTS=0
BUILD=0

command="${1:-}"
shift || true

for flag in "$@"; do
    case "$flag" in
        --caddy) WITH_CADDY=1 ;;
        --plain) WITH_AUTH=0 ;;
        --no-ports) NO_PORTS=1 ;;
        --build) BUILD=1 ;;
        *) echo "unknown flag: $flag"; exit 1 ;;
    esac
done

# the bundled Caddy brings its own Authelia and publishes nothing else, so the
# port overlays would only get in its way.
if (( WITH_CADDY )); then
    FILES+=(-f docker-compose.caddy.yml)
    NO_PORTS=0
elif (( WITH_AUTH )); then
    FILES+=(-f docker-compose.authelia.yml)
fi

if (( NO_PORTS )); then
    FILES+=(-f docker-compose.no-ports.yml)
    if (( WITH_AUTH )); then
        FILES+=(-f docker-compose.authelia-no-ports.yml)
    fi
fi

preflight() {
    [[ -f .env ]] || { echo "no .env yet. copy .env.example to .env first."; exit 1; }
    if (( WITH_AUTH || WITH_CADDY )); then
        [[ -f deploy/authelia/users.yml ]] || {
            echo "no deploy/authelia/users.yml yet. run scripts/init-auth.sh first."
            exit 1
        }
        local missing=()
        for key in AUTHELIA_SESSION_SECRET AUTHELIA_STORAGE_ENCRYPTION_KEY AUTHELIA_JWT_SECRET; do
            grep -qE "^${key}=.+" .env || missing+=("$key")
        done
        if (( ${#missing[@]} )); then
            echo "missing in .env: ${missing[*]}"
            echo "run scripts/init-auth.sh to generate them."
            exit 1
        fi
        for key in CADENCE_DOMAIN AUTH_DOMAIN; do
            grep -qE "^${key}=.+" .env || { echo "set ${key} in .env"; exit 1; }
        done
    fi
}

describe() {
    local parts="app"
    (( WITH_CADDY )) && parts+=" + Authelia + Caddy"
    (( WITH_CADDY == 0 && WITH_AUTH )) && parts+=" + Authelia"
    (( NO_PORTS )) && parts+=", no published ports"
    echo "$parts"
}

case "$command" in
    start)
        preflight
        echo "starting: $(describe)"
        if (( BUILD )); then
            docker compose "${FILES[@]}" build
        fi
        docker compose "${FILES[@]}" up -d
        docker compose "${FILES[@]}" ps
        ;;
    stop)
        # plain `down`: containers and the network go, the volumes stay.
        # never -v here, see `reset` below.
        docker compose "${FILES[@]}" down
        ;;
    restart)
        docker compose "${FILES[@]}" down
        preflight
        docker compose "${FILES[@]}" up -d
        ;;
    status)
        docker compose "${FILES[@]}" ps
        ;;
    logs)
        docker compose "${FILES[@]}" logs -f --tail=100 "$@"
        ;;
    reset)
        # -v deletes the named volumes: the Authelia database (users' TOTP
        # enrolments, sessions) and, with --caddy, the TLS certificates and
        # the ACME account key. re-issuing counts against Let's Encrypt rate
        # limits, so this is deliberately separate from `stop`.
        echo "this deletes the Authelia database and, with --caddy, the TLS certificates."
        read -rp "type 'reset' to confirm: " answer
        [[ "$answer" == "reset" ]] || { echo "cancelled."; exit 1; }
        docker compose "${FILES[@]}" down -v
        ;;
    *)
        sed -n '2,17p' "$0" | sed 's/^# \?//'
        exit 1
        ;;
esac
