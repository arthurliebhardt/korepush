#!/usr/bin/env bash
#
# korepush installer — turns a fresh Linux host into a single-node PaaS.
#
#   curl -sfL https://get.korepush.dev | sudo bash
#
# Environment overrides:
#   KOREPUSH_DOMAIN   Hostname the UI is served on (default: server public IP)
#   KOREPUSH_IMAGE    Control-plane image (default: ghcr.io/arthurliebhardt/korepush:latest)
#   KOREPUSH_MANIFEST Path or URL to deploy manifest (default: bundled/remote)
#   KOREPUSH_MONITORING_MANIFEST  Path or URL to monitoring manifest (default: bundled/remote)
#   KOREPUSH_ACME_EMAIL  Contact email for Let's Encrypt (HTTPS on custom domains)
#   KOREPUSH_SKIP_CERTMANAGER  Set to skip installing cert-manager + issuers
#
set -euo pipefail

KOREPUSH_IMAGE="${KOREPUSH_IMAGE:-ghcr.io/arthurliebhardt/korepush:latest}"
MANIFEST_URL="${KOREPUSH_MANIFEST:-https://raw.githubusercontent.com/arthurliebhardt/korepush/main/deploy/korepush.yaml}"
KUBECTL="/usr/local/bin/kubectl"

log()  { printf '\033[1;36m[korepush]\033[0m %s\n' "$1"; }
err()  { printf '\033[1;31m[korepush]\033[0m %s\n' "$1" >&2; }
die()  { err "$1"; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Please run as root (e.g. with sudo)."

# 1. Determine how the control plane will be reached.
if [ -z "${KOREPUSH_DOMAIN:-}" ]; then
  KOREPUSH_DOMAIN="$(curl -sf https://api.ipify.org || hostname -I | awk '{print $1}')"
  log "No KOREPUSH_DOMAIN set; using detected address: ${KOREPUSH_DOMAIN}"
fi

# Two modes:
#  - domain: serve the UI on that host via an Ingress host rule.
#  - ip:     no domain yet — serve on the raw IP via a host-less (catch-all)
#            Ingress so http://<ip> works immediately, no DNS needed. sslip.io
#            is still used as the *app* base domain so deployed apps get a
#            resolvable hostname (<app>.<space>.<ip>.sslip.io) until a real
#            wildcard domain is configured (later, via Settings).
case "$KOREPUSH_DOMAIN" in
  *[!0-9.]*)
    MODE="domain"
    INGRESS_HOST="$KOREPUSH_DOMAIN"
    # Domain mode: serve over HTTPS. cert-manager provisions a Let's Encrypt
    # cert for the Ingress once DNS resolves here and :80 is reachable (~1 min);
    # both http+https origins are trusted so there's no window with no access.
    AUTH_URL="https://${KOREPUSH_DOMAIN}"
    APP_BASE_DOMAIN="$KOREPUSH_DOMAIN"
    TRUSTED_ORIGINS="https://${KOREPUSH_DOMAIN},http://${KOREPUSH_DOMAIN}"
    ;;
  *)
    MODE="ip"
    INGRESS_HOST=""
    AUTH_URL="http://${KOREPUSH_DOMAIN}"
    APP_BASE_DOMAIN="${KOREPUSH_DOMAIN}.sslip.io"
    TRUSTED_ORIGINS="$AUTH_URL"
    log "No domain given; control plane will be served on http://${KOREPUSH_DOMAIN}"
    ;;
esac

# 2. Configure containerd to pull from the in-cluster registry. Builds push to
#    registry.korepush-system.svc.cluster.local:5000 (svc DNS, in-cluster); the
#    host's containerd can't resolve that, so mirror it to the node-local
#    NodePort over plain HTTP. k3s reads this only at startup.
mkdir -p /etc/rancher/k3s
cat > /etc/rancher/k3s/registries.yaml <<'EOF'
mirrors:
  "registry.korepush-system.svc.cluster.local:5000":
    endpoint:
      - "http://127.0.0.1:30000"
configs:
  "127.0.0.1:30000":
    tls:
      insecure_skip_verify: true
EOF

# 3. Install k3s (bundles containerd, Traefik ingress, kubectl, local-path storage).
if ! command -v k3s >/dev/null 2>&1; then
  log "Installing k3s…"
  curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--write-kubeconfig-mode 644" sh -
else
  log "k3s already installed; restarting to apply registry config…"
  systemctl restart k3s
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

# Install the CloudNativePG operator (Postgres databases in spaces). Reuse an
# existing install (e.g. Helm) if present — re-applying our manifest over a
# different field manager would conflict. --server-side: the CRDs are too large
# for client-side apply.
log "Installing CloudNativePG operator…"
if "$KUBECTL" get crd clusters.postgresql.cnpg.io >/dev/null 2>&1; then
  log "CloudNativePG already present; using the existing installation."
else
  CNPG_MANIFEST="${KOREPUSH_CNPG_MANIFEST:-https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/release-1.29/releases/cnpg-1.29.1.yaml}"
  "$KUBECTL" apply --server-side -f "$CNPG_MANIFEST" || die "Failed to install CloudNativePG."
fi
"$KUBECTL" -n cnpg-system rollout status deploy/cnpg-controller-manager --timeout=180s ||
  err "CloudNativePG not ready yet; databases will work once its controller starts."

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 3a. Install cert-manager + Let's Encrypt ClusterIssuers (HTTPS for custom
#     domains). cert-manager CRDs are large → --server-side (like CNPG). Its
#     webhook must be Ready before Issuers apply, so wait then retry the apply.
if [ -z "${KOREPUSH_SKIP_CERTMANAGER:-}" ]; then
  # Reuse an existing cert-manager (e.g. Helm-installed) rather than re-applying
  # our manifest over it — a server-side apply would conflict with its manager.
  if "$KUBECTL" get crd clusterissuers.cert-manager.io >/dev/null 2>&1; then
    log "cert-manager already present; using the existing installation."
    "$KUBECTL" -n cert-manager rollout status \
      deploy/cert-manager deploy/cert-manager-webhook deploy/cert-manager-cainjector \
      --timeout=300s 2>/dev/null ||
      log "Couldn't confirm cert-manager readiness (different namespace?); continuing."
  else
    log "Installing cert-manager…"
    CM_MANIFEST="${KOREPUSH_CERTMANAGER_MANIFEST:-https://github.com/cert-manager/cert-manager/releases/download/v1.18.2/cert-manager.yaml}"
    "$KUBECTL" apply --server-side -f "$CM_MANIFEST" || die "Failed to install cert-manager."
    "$KUBECTL" -n cert-manager rollout status \
      deploy/cert-manager deploy/cert-manager-webhook deploy/cert-manager-cainjector \
      --timeout=300s || die "cert-manager did not become ready."
  fi

  log "Creating Let's Encrypt ClusterIssuers…"
  ISSUERS="$WORK/cluster-issuers.yaml"
  if [ -f "./deploy/cluster-issuers.yaml" ]; then
    cp ./deploy/cluster-issuers.yaml "$ISSUERS"
  else
    curl -sfL "${KOREPUSH_CLUSTERISSUERS_MANIFEST:-https://raw.githubusercontent.com/arthurliebhardt/korepush/main/deploy/cluster-issuers.yaml}" \
      -o "$ISSUERS" || die "Failed to download ClusterIssuers manifest."
  fi
  if [ -n "${KOREPUSH_ACME_EMAIL:-}" ]; then
    sed -i "s|__ACME_EMAIL__|${KOREPUSH_ACME_EMAIL}|g" "$ISSUERS"
  else
    # No email → register the ACME account without a contact (valid). The
    # admin's email backfills it when a domain is added via Settings.
    sed -i "/__ACME_EMAIL__/d" "$ISSUERS"
  fi
  # The webhook can lag behind its Deployment going Available; retry until it
  # accepts the Issuers (no extra binary, ~equivalent to `cmctl check api`).
  for _ in $(seq 1 30); do
    "$KUBECTL" apply -f "$ISSUERS" >/dev/null 2>&1 && break
    log "Waiting for cert-manager webhook to accept ClusterIssuers…"
    sleep 2
  done
  "$KUBECTL" get clusterissuer letsencrypt-prod >/dev/null 2>&1 ||
    err "ClusterIssuers not created yet; HTTPS will work once cert-manager is fully up."

  # cert-manager Gateway API support (for HTTP-01 via the shared Gateway). Only
  # detected at startup, so add the flag idempotently + restart.
  if ! "$KUBECTL" -n cert-manager get deploy cert-manager \
      -o jsonpath='{.spec.template.spec.containers[0].args}' 2>/dev/null | grep -q enable-gateway-api; then
    "$KUBECTL" -n cert-manager patch deploy cert-manager --type=json \
      -p '[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--enable-gateway-api"}]' >/dev/null 2>&1 || true
  fi
fi

# 3a-bis. Enable Traefik's Gateway API provider (additive — the Ingress
# provider stays on). k3s applies HelmChartConfigs dropped in its manifests dir;
# the Gateway API CRDs + GatewayClass ship with the k3s traefik-crds chart.
# Listener ports are Traefik's internal entrypoints (8000/8443), see gateway.yaml.
log "Enabling Gateway API (Traefik provider)…"
cat > /var/lib/rancher/k3s/server/manifests/korepush-traefik-gateway.yaml <<'YAML'
apiVersion: helm.cattle.io/v1
kind: HelmChartConfig
metadata:
  name: traefik
  namespace: kube-system
spec:
  valuesContent: |-
    providers:
      kubernetesGateway:
        enabled: true
YAML
for _ in $(seq 1 40); do
  "$KUBECTL" get gatewayclass traefik >/dev/null 2>&1 && break
  sleep 3
done
GATEWAY="$WORK/gateway.yaml"
if [ -f "./deploy/gateway.yaml" ]; then cp ./deploy/gateway.yaml "$GATEWAY"
else curl -sfL "${KOREPUSH_GATEWAY_MANIFEST:-https://raw.githubusercontent.com/arthurliebhardt/korepush/main/deploy/gateway.yaml}" -o "$GATEWAY" || die "Failed to download gateway manifest."
fi
"$KUBECTL" apply -f "$GATEWAY" || err "Shared Gateway not applied; routing will fall back to Ingress."

# 3. Fetch the deploy manifest (prefer a local copy when run from a checkout).
MANIFEST="$WORK/korepush.yaml"
if [ -f "./deploy/korepush.yaml" ]; then
  log "Using bundled manifest ./deploy/korepush.yaml"
  cp ./deploy/korepush.yaml "$MANIFEST"
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
  -e "s|__KOREPUSH_IMAGE__|${KOREPUSH_IMAGE}|g" \
  -e "s|__AUTH_URL__|${AUTH_URL}|g" \
  -e "s|__APP_BASE_DOMAIN__|${APP_BASE_DOMAIN}|g" \
  -e "s|__TRUSTED_ORIGINS__|${TRUSTED_ORIGINS}|g" \
  -e "s|__AUTH_SECRET__|${AUTH_SECRET}|g" \
  -e "s|__DB_PASSWORD__|${DB_PASSWORD}|g" \
  -e "s|__ACME_EMAIL__|${KOREPUSH_ACME_EMAIL:-}|g" \
  "$MANIFEST"

# 4b. Install the monitoring stack (Prometheus + kube-state-metrics +
#     node-exporter + Grafana). Plain manifests → client-side apply is fine
#     (unlike CNPG's huge CRDs). Grafana is served at <auth-url>/grafana with a
#     freshly generated admin password (printed in the summary below).
log "Installing monitoring stack (Prometheus + Grafana)…"
GRAFANA_PASSWORD="$(gen)"
MONITORING_MANIFEST="${KOREPUSH_MONITORING_MANIFEST:-https://raw.githubusercontent.com/arthurliebhardt/korepush/main/deploy/monitoring.yaml}"
MON="$WORK/monitoring.yaml"
if [ -f "./deploy/monitoring.yaml" ]; then
  log "Using bundled monitoring manifest ./deploy/monitoring.yaml"
  cp ./deploy/monitoring.yaml "$MON"
else
  log "Downloading monitoring manifest…"
  curl -sfL "$MONITORING_MANIFEST" -o "$MON" || die "Failed to download monitoring manifest."
fi
sed -i \
  -e "s|__AUTH_URL__|${AUTH_URL}|g" \
  -e "s|__GRAFANA_PASSWORD__|${GRAFANA_PASSWORD}|g" \
  "$MON"
"$KUBECTL" apply -f "$MON" || die "Failed to install monitoring stack."
# Generous timeout: a cold node pulls Prometheus/Grafana images concurrently.
"$KUBECTL" -n korepush-monitoring rollout status deploy/prometheus --timeout=300s ||
  err "Prometheus not ready yet; metrics will appear once it starts."
"$KUBECTL" -n korepush-monitoring rollout status deploy/grafana --timeout=300s ||
  err "Grafana not ready yet; it will come up shortly."

# 5. Apply and wait for rollout.
log "Deploying korepush…"
"$KUBECTL" apply -f "$MANIFEST"

# In domain mode, route the domain to the control plane and (unless cert-manager
# was skipped) provision its cert on the shared Gateway's https listener, so
# https://<domain> works once DNS points here. The host-less catch-all HTTPRoute
# keeps the raw IP serving over HTTP.
if [ "$MODE" = "domain" ] && [ -z "${KOREPUSH_SKIP_GATEWAY:-}" ]; then
  if [ -z "${KOREPUSH_SKIP_CERTMANAGER:-}" ]; then
    log "Provisioning HTTPS for ${INGRESS_HOST}…"
    "$KUBECTL" -n kube-system patch gateway korepush --type=json \
      -p "[{\"op\":\"add\",\"path\":\"/spec/listeners/-\",\"value\":{\"name\":\"https\",\"protocol\":\"HTTPS\",\"port\":8443,\"tls\":{\"mode\":\"Terminate\",\"certificateRefs\":[{\"kind\":\"Secret\",\"group\":\"\",\"name\":\"korepush-panel-tls\"}]},\"allowedRoutes\":{\"namespaces\":{\"from\":\"All\"}}}}]" 2>/dev/null || true
    "$KUBECTL" apply -f - <<YAML || err "Control-plane domain route not applied."
apiVersion: cert-manager.io/v1
kind: Certificate
metadata: { name: korepush-panel-tls, namespace: kube-system }
spec:
  secretName: korepush-panel-tls
  dnsNames: ["${INGRESS_HOST}"]
  issuerRef: { name: letsencrypt-prod, kind: ClusterIssuer, group: cert-manager.io }
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata: { name: korepush-cp, namespace: korepush-system, labels: { app.kubernetes.io/managed-by: korepush } }
spec:
  parentRefs:
    - { name: korepush, namespace: kube-system, sectionName: web }
    - { name: korepush, namespace: kube-system, sectionName: https }
  hostnames: ["${INGRESS_HOST}"]
  rules:
    - backendRefs: [{ name: korepush, port: 80 }]
YAML
  fi
fi

# Generous timeouts: a cold k3s pulls system images (storage, ingress) and the
# control-plane image concurrently on first boot, so first rollout can be slow.
"$KUBECTL" -n korepush-system rollout status deploy/postgres --timeout=420s
"$KUBECTL" -n korepush-system rollout status deploy/korepush --timeout=420s

log "Done!"
echo
echo "  korepush is running. Open:  ${AUTH_URL}"
echo "  First visit will prompt you to create the admin account."
if [ "$MODE" = "domain" ] && [ -z "${KOREPUSH_SKIP_CERTMANAGER:-}" ]; then
  echo
  echo "  HTTPS: a Let's Encrypt certificate is being issued for ${KOREPUSH_DOMAIN}."
  echo "  It needs this domain's DNS pointing here and port 80 open; allow ~1 min."
  echo "  Track it: kubectl -n korepush-system get certificate"
  echo "  For apps over HTTPS, point a wildcard *.${KOREPUSH_DOMAIN} at this server too."
fi
echo
echo "  Grafana (metrics):  ${AUTH_URL}/grafana"
echo "    user: admin   password: ${GRAFANA_PASSWORD}"
echo "    (retrieve later: kubectl -n korepush-monitoring get secret grafana-admin -o jsonpath='{.data.admin-password}' | base64 -d)"
echo
