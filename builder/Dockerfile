# syntax=docker/dockerfile:1
#
# korepush build agent: buildctl (from moby/buildkit) + git + the Railpack CLI.
# Used as the build container in korepush build Jobs (the buildkitd sidecar is a
# separate moby/buildkit container).
#
# Debian (glibc) base: Railpack's `prepare` downloads `mise` to provision build
# toolchains, and mise ships glibc binaries — they fail to exec on alpine/musl.
# The railpack + buildctl binaries are static and run fine on glibc.
FROM moby/buildkit:v0.27.0 AS bk

FROM debian:bookworm-slim
ARG TARGETARCH
ARG RAILPACK_VERSION=v0.23.0

RUN apt-get update \
    && apt-get install -y --no-install-recommends git curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=bk /usr/bin/buildctl /usr/local/bin/buildctl

RUN set -eux; \
    case "$TARGETARCH" in \
      amd64) rp_arch=x86_64 ;; \
      arm64) rp_arch=arm64 ;; \
      *) echo "unsupported arch: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    url="https://github.com/railwayapp/railpack/releases/download/${RAILPACK_VERSION}/railpack-${RAILPACK_VERSION}-${rp_arch}-unknown-linux-musl.tar.gz"; \
    curl -fsSL "$url" -o /tmp/railpack.tar.gz; \
    mkdir -p /tmp/rp; \
    tar -xzf /tmp/railpack.tar.gz -C /tmp/rp; \
    bin="$(find /tmp/rp -type f -name 'railpack*' | head -1)"; \
    mv "$bin" /usr/local/bin/railpack; \
    chmod +x /usr/local/bin/railpack; \
    rm -rf /tmp/railpack.tar.gz /tmp/rp; \
    railpack --version; \
    buildctl --version
