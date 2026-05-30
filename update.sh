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

# 3b. Enable the Gateway API (Traefik provider + cert-manager support + the
#     shared Gateway). Additive and idempotent; the Ingress provider stays on.
if [ -z "${KOREPUSH_SKIP_GATEWAY:-}" ] && [ -d /var/lib/rancher/k3s/server/manifests ]; then
  log "Ensuring Gateway API is enabled…"
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
  for _ in $(seq 1 40); do $KUBECTL get gatewayclass traefik >/dev/null 2>&1 && break; sleep 3; done
  if $KUBECTL -n cert-manager get deploy cert-manager >/dev/null 2>&1 &&
     ! $KUBECTL -n cert-manager get deploy cert-manager -o jsonpath='{.spec.template.spec.containers[0].args}' 2>/dev/null | grep -q enable-gateway-api; then
    $KUBECTL -n cert-manager patch deploy cert-manager --type=json \
      -p '[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--enable-gateway-api"}]' >/dev/null 2>&1 || true
  fi
  fetch "./deploy/gateway.yaml" "$RAW/deploy/gateway.yaml" "$WORK/gateway.yaml"
  $KUBECTL apply -f "$WORK/gateway.yaml" || err "Shared Gateway not applied."

  # 3c. Static HTTPRoutes (control-plane catch-all + Grafana) + switch the ACME
  #     HTTP-01 solver to the Gateway. Per-app HTTPRoutes are created by the
  #     rolled control plane's startup hook (step 4).
  fetch "./deploy/korepush.yaml" "$RAW/deploy/korepush.yaml" "$WORK/cp.yaml"
  fetch "./deploy/monitoring.yaml" "$RAW/deploy/monitoring.yaml" "$WORK/mon.yaml"
  awk 'BEGIN{RS="\n---\n"} /kind: HTTPRoute/{print $0"\n---"}' "$WORK/cp.yaml" "$WORK/mon.yaml" |
    $KUBECTL apply -f - || err "Gateway HTTPRoutes not applied."
  for ISS in letsencrypt-prod letsencrypt-staging; do
    $KUBECTL get clusterissuer "$ISS" >/dev/null 2>&1 &&
      $KUBECTL patch clusterissuer "$ISS" --type=merge \
        -p '{"spec":{"acme":{"solvers":[{"http01":{"gatewayHTTPRoute":{"parentRefs":[{"name":"korepush","namespace":"kube-system","kind":"Gateway","sectionName":"web"}]}}}]}}}' >/dev/null 2>&1 || true
  done
fi

# 3d. KoreApp CRD + operator. The CRD apply is idempotent; the operator manifest
#     carries no secrets (it reads KOREPUSH_BASE_DOMAIN from the existing
#     korepush-app secret), so re-applying is safe. Keep the currently-deployed
#     operator image unless KOREPUSH_OPERATOR_IMAGE overrides it; default for
#     installs that predate the operator.
log "Installing/refreshing the KoreApp CRD + operator…"
fetch "./deploy/crds/koreapp.yaml" "$RAW/deploy/crds/koreapp.yaml" "$WORK/koreapp-crd.yaml"
$KUBECTL apply -f "$WORK/koreapp-crd.yaml" || err "KoreApp CRD not applied."
$KUBECTL wait --for=condition=Established crd/koreapps.korepush.io --timeout=60s >/dev/null 2>&1 || true
OP_IMAGE="${KOREPUSH_OPERATOR_IMAGE:-$($KUBECTL -n "$NS" get deploy korepush-operator \
  -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || echo ghcr.io/arthurliebhardt/korepush-operator:latest)}"
fetch "./deploy/operator.yaml" "$RAW/deploy/operator.yaml" "$WORK/operator.yaml"
sed -i -e "s|__KOREPUSH_OPERATOR_IMAGE__|${OP_IMAGE}|g" "$WORK/operator.yaml"
$KUBECTL apply -f "$WORK/operator.yaml" || err "Operator not applied; KoreApp CRs won't reconcile."
$KUBECTL -n "$NS" rollout restart deploy/korepush-operator >/dev/null 2>&1 || true

# 4. Pull the latest control plane (migrations + the HTTPRoute startup hook).
if [ -n "${KOREPUSH_IMAGE:-}" ]; then
  $KUBECTL -n "$NS" set image deploy/korepush "korepush=${KOREPUSH_IMAGE}"
fi
log "Updating the control plane (this also runs any new database migrations)…"
$KUBECTL -n "$NS" rollout restart deploy/korepush
$KUBECTL -n "$NS" rollout status deploy/korepush --timeout=300s

# 5. Big-bang Gateway cutover: once the control plane is up (its startup hook
#    has created the per-app HTTPRoutes), snapshot then remove the Ingresses so
#    the Gateway becomes authoritative. Rollback: re-apply the backup.
if [ -z "${KOREPUSH_SKIP_GATEWAY:-}" ] &&
   $KUBECTL get gatewayclass traefik >/dev/null 2>&1 &&
   [ -n "$($KUBECTL get ingress -A -o name 2>/dev/null)" ]; then
  log "Cutting over to the Gateway (removing Ingresses)…"
  $KUBECTL get ingress -A -o yaml > /tmp/korepush-ingress-backup.yaml 2>/dev/null || true
  log "  Ingress backup: /tmp/korepush-ingress-backup.yaml (rollback: kubectl apply -f it)"
  sleep 6 # let the startup hook finish creating per-app HTTPRoutes
  $KUBECTL -n "$NS" delete ingress korepush --ignore-not-found >/dev/null 2>&1 || true
  $KUBECTL -n korepush-monitoring delete ingress grafana --ignore-not-found >/dev/null 2>&1 || true
  for SNS in $($KUBECTL get ns -o name 2>/dev/null | grep -oE 'ks-[a-z0-9-]+'); do
    $KUBECTL -n "$SNS" delete ingress --all >/dev/null 2>&1 || true
  done
fi

log "Done — korepush is up to date."
