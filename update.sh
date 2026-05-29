#!/usr/bin/env bash
#
# korepush updater — safe to run repeatedly on an existing install.
#
#   curl -sfL https://raw.githubusercontent.com/arthurliebhardt/korepush/main/update.sh | sudo bash
#
# It pulls the latest control-plane image (database migrations run on startup),
# refreshes RBAC, and installs any newer cluster components (cert-manager,
# monitoring) that your install predates. It NEVER touches your secrets,
# Postgres data, or the domain/TLS you configured via Settings.
#
# Overrides: KOREPUSH_IMAGE (default: keep the currently-deployed image).
set -euo pipefail

KUBECTL="/usr/local/bin/kubectl"
command -v "$KUBECTL" >/dev/null 2>&1 || KUBECTL="k3s kubectl"
export KUBECONFIG="${KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"
NS="korepush-system"
RAW="https://raw.githubusercontent.com/arthurliebhardt/korepush/main"

log() { printf '\033[1;36m[korepush]\033[0m %s\n' "$1"; }
err() { printf '\033[1;31m[korepush]\033[0m %s\n' "$1" >&2; }
die() { err "$1"; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Please run as root (e.g. with sudo)."
$KUBECTL -n "$NS" get deploy korepush >/dev/null 2>&1 ||
  die "No korepush install found in '$NS'. Run the installer first."

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
# Prefer a local checkout's manifests, else fetch from main.
fetch() { # <local-path> <url> <out>
  if [ -f "$1" ]; then cp "$1" "$3"; else curl -sfL "$2" -o "$3" || die "Download failed: $2"; fi
}

# 1. cert-manager + Let's Encrypt issuers — install only if absent (an older
#    install predates HTTPS). Reuse any existing cert-manager.
if [ -z "${KOREPUSH_SKIP_CERTMANAGER:-}" ] &&
   ! $KUBECTL get crd clusterissuers.cert-manager.io >/dev/null 2>&1; then
  log "Installing cert-manager…"
  $KUBECTL apply --server-side -f \
    "https://github.com/cert-manager/cert-manager/releases/download/v1.18.2/cert-manager.yaml" ||
    die "Failed to install cert-manager."
  $KUBECTL -n cert-manager rollout status \
    deploy/cert-manager deploy/cert-manager-webhook deploy/cert-manager-cainjector \
    --timeout=300s || err "cert-manager not ready yet."
fi
if $KUBECTL get crd clusterissuers.cert-manager.io >/dev/null 2>&1 &&
   ! $KUBECTL get clusterissuer letsencrypt-prod >/dev/null 2>&1; then
  log "Creating Let's Encrypt ClusterIssuers…"
  fetch "./deploy/cluster-issuers.yaml" "$RAW/deploy/cluster-issuers.yaml" "$WORK/issuers.yaml"
  # Emailless ACME account; the admin email backfills when a domain is added.
  sed -i "/__ACME_EMAIL__/d" "$WORK/issuers.yaml"
  for _ in $(seq 1 30); do
    $KUBECTL apply -f "$WORK/issuers.yaml" >/dev/null 2>&1 && break
    sleep 2
  done
fi

# 2. Monitoring stack — install only if its namespace is absent (never touches
#    the existing Grafana secret on a re-run).
if ! $KUBECTL get ns korepush-monitoring >/dev/null 2>&1; then
  log "Installing monitoring stack…"
  fetch "./deploy/monitoring.yaml" "$RAW/deploy/monitoring.yaml" "$WORK/mon.yaml"
  GPW="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"
  AUTH_URL="$($KUBECTL -n "$NS" get secret korepush-app -o jsonpath='{.data.BETTER_AUTH_URL}' 2>/dev/null | base64 -d || echo "http://localhost")"
  sed -i -e "s|__AUTH_URL__|${AUTH_URL}|g" -e "s|__GRAFANA_PASSWORD__|${GPW}|g" "$WORK/mon.yaml"
  $KUBECTL apply -f "$WORK/mon.yaml" || err "Monitoring stack not fully applied."
  echo "    Grafana admin password: ${GPW}"
fi

# 3. Refresh RBAC — apply ONLY the ClusterRole + ClusterRoleBinding (newer
#    releases add rules). These carry no secrets/placeholders, so re-applying
#    is safe; the Secrets, Ingress (your domain/TLS), Postgres and registry are
#    left untouched.
log "Refreshing RBAC…"
fetch "./deploy/korepush.yaml" "$RAW/deploy/korepush.yaml" "$WORK/cp.yaml"
awk 'BEGIN{RS="\n---\n"} /\nkind: ClusterRole/{print $0"\n---"}' "$WORK/cp.yaml" |
  $KUBECTL apply -f - || err "RBAC refresh skipped."

# 4. Pull the latest control plane (migrations run on startup via entrypoint).
if [ -n "${KOREPUSH_IMAGE:-}" ]; then
  $KUBECTL -n "$NS" set image deploy/korepush "korepush=${KOREPUSH_IMAGE}"
fi
log "Updating the control plane (this also runs any new database migrations)…"
$KUBECTL -n "$NS" rollout restart deploy/korepush
$KUBECTL -n "$NS" rollout status deploy/korepush --timeout=300s

log "Done — korepush is up to date."
