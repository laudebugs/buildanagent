# The sandbox image for N50's live cases: the base image of Cloudflare's managed `cloudflare/debian-trixie`
# (node:24.20.0-trixie-slim, amd64, pinned by digest), plus curl, Git and the CA bundle, and the `sandbox-shim`
# helper that `Files` from @cloudflare/sandbox 1.0.3 runs, from the matching image tag.
FROM node:24.20.0-trixie-slim@sha256:a747ad80c8a161b650d79a6da9c422005b91148b18b8d2c669eb5a0b7c07e600

RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates curl git \
	&& rm -rf /var/lib/apt/lists/*

COPY --from=docker.io/cloudflare/sandbox:1.0.3@sha256:fc1740c3cba26461f0ab1771287c84018ab2cca43a70ebb823087c85d780aaec /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim

WORKDIR /workspace
CMD ["sleep", "infinity"]
