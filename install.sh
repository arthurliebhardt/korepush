#!/usr/bin/env bash
#
# kubepush installer — turns a fresh Linux host into a single-node PaaS.
#
#   curl -sfL https://get.kubepush.dev | sudo bash
#
# Environment overrides:
#   KUBEPUSH_DOMAIN   Hostname the UI is served on (default: server public IP)
#   KUBEPUSH_IMAGE    Control-plane image (default: ghcr.io/kubepush/kubepush:latest)
#   KUBEPUSH_MANIFEST Path or URL to deploy manifest (default: bundled/remote)
#
set -euo pipefail

KUBEPUSH_IMAGE="${KUBEPUSH_IMAGE:-ghcr.io/kubepush/kubepush:latest}"
MANIFEST_URL="${KUBEPUSH_MANIFEST:-https://raw.githubusercontent.com/kubepush/kubepush/main/deploy/kubepush.yaml}"
KUBECTL="/usr/local/bin/kubectl"

log()  { printf '\033[1;36m[kubepush]\033[0m %s\n' "$1"; }
err()  { printf '\033[1;31m[kubepush]\033[0m %s\n' "$1" >&2; }
die()  { err "$1"; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Please run as root (e.g. with sudo)."

# 1. Determine how the control plane will be reached.
if [ -z "${KUBEPUSH_DOMAIN:-}" ]; then
  KUBEPUSH_DOMAIN="$(curl -sf https://api.ipify.org || hostname -I | awk '{print $1}')"
  log "No KUBEPUSH_DOMAIN set; using detected address: ${KUBEPUSH_DOMAIN}"
fi

# Two modes:
#  - domain: serve the UI on that host via an Ingress host rule.
#  - ip:     no domain yet — serve on the raw IP via a host-less (catch-all)
#            Ingress so http://<ip> works immediately, no DNS needed. sslip.io
#            is still used as the *app* base domain so deployed apps get a
#            resolvable hostname (<app>.<space>.<ip>.sslip.io) until a real
#            wildcard domain is configured (later, via Settings).
case "$KUBEPUSH_DOMAIN" in
  *[!0-9.]*)
    MODE="domain"
    INGRESS_HOST="$KUBEPUSH_DOMAIN"
    AUTH_URL="http://${KUBEPUSH_DOMAIN}"
    APP_BASE_DOMAIN="$KUBEPUSH_DOMAIN"
    ;;
  *)
    MODE="ip"
    INGRESS_HOST=""
    AUTH_URL="http://${KUBEPUSH_DOMAIN}"
    APP_BASE_DOMAIN="${KUBEPUSH_DOMAIN}.sslip.io"
    log "No domain given; control plane will be served on http://${KUBEPUSH_DOMAIN}"
    ;;
esac
TRUSTED_ORIGINS="$AUTH_URL"

# 2. Install k3s (bundles containerd, Traefik ingress, kubectl, local-path storage).
if ! command -v k3s >/dev/null 2>&1; then
  log "Installing k3s…"
  curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--write-kubeconfig-mode 644" sh -
else
  log "k3s already installed; skipping."
fi
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

log "Waiting for the cluster to become ready…"
node_ready() {
  # Avoid `kubectl | grep` under `pipefail` (grep closing early SIGPIPEs kubectl).
  case "$("$KUBECTL" get nodes 2>/dev/null || true)" in
    *" Ready"*) return 0 ;;
    *) return 1 ;;
  esac
}
for _ in $(seq 1 60); do
  if node_ready; then break; fi
  sleep 2
done
node_ready || die "Cluster did not become ready in time."

# 3. Fetch the deploy manifest (prefer a local copy when run from a checkout).
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
MANIFEST="$WORK/kubepush.yaml"
if [ -f "./deploy/kubepush.yaml" ]; then
  log "Using bundled manifest ./deploy/kubepush.yaml"
  cp ./deploy/kubepush.yaml "$MANIFEST"
else
  log "Downloading manifest…"
  curl -sfL "$MANIFEST_URL" -o "$MANIFEST" || die "Failed to download manifest."
fi

# 4. Generate secrets and substitute placeholders.
# No trailing `head -c` (it SIGPIPEs the upstream and trips `pipefail`); base64
# of 48 random bytes yields ~60 alphanumeric chars (>=32 for better-auth).
gen() { head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9'; }
AUTH_SECRET="$(gen)"
DB_PASSWORD="$(gen)"

sed -i \
  -e "s|__KUBEPUSH_IMAGE__|${KUBEPUSH_IMAGE}|g" \
  -e "s|__AUTH_URL__|${AUTH_URL}|g" \
  -e "s|__APP_BASE_DOMAIN__|${APP_BASE_DOMAIN}|g" \
  -e "s|__TRUSTED_ORIGINS__|${TRUSTED_ORIGINS}|g" \
  -e "s|__AUTH_SECRET__|${AUTH_SECRET}|g" \
  -e "s|__DB_PASSWORD__|${DB_PASSWORD}|g" \
  "$MANIFEST"

# 5. Apply and wait for rollout.
log "Deploying kubepush…"
"$KUBECTL" apply -f "$MANIFEST"

# In domain mode, attach the host to the (otherwise catch-all) Ingress rule.
if [ "$MODE" = "domain" ]; then
  "$KUBECTL" -n kubepush-system patch ingress kubepush --type=json \
    -p "[{\"op\":\"add\",\"path\":\"/spec/rules/0/host\",\"value\":\"${INGRESS_HOST}\"}]"
fi

"$KUBECTL" -n kubepush-system rollout status deploy/postgres --timeout=180s
"$KUBECTL" -n kubepush-system rollout status deploy/kubepush --timeout=300s

log "Done!"
echo
echo "  kubepush is running. Open:  ${AUTH_URL}"
echo "  First visit will prompt you to create the admin account."
echo
