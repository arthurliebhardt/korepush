# GitOps with korepush

korepush bundles [Flux](https://fluxcd.io). Commit your `KoreApp` / `KoreSpace`
/ `KoreDatabase` manifests to a git repo and point Flux at it: Flux applies
them, the korepush operator reconciles them, and the dashboard shows each app's
sync status. Git-managed apps are **read-only** in the UI (git is the source of
truth) — change them by committing to the repo.

## 1. Put manifests in a repo

One file per resource (see `koreapp.example.yaml`), e.g. `apps/web.yaml`. The
space's namespace (`ks-<space-slug>`) must exist — create the space in the UI
first (surfacing git-created spaces in the UI is a later phase).

## 2. Point Flux at the repo

Edit `flux-source.yaml` (set your repo URL + branch), then apply it on the
server:

    kubectl apply -f flux-source.yaml

Flux fetches the repo and applies the manifests; the operator reconciles the
KoreApps; they appear in the dashboard tagged **GitOps**. For a private repo,
create a Secret and reference it from the GitRepository (`spec.secretRef`) — see
the Flux docs.

## 3. Deploy by committing

Edit a manifest, push to the branch — Flux syncs (default every minute) and the
operator rolls the change. The dashboard shows the synced commit + status.
