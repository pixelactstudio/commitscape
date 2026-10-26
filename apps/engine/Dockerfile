FROM rust:1-slim-bookworm AS binary
WORKDIR /src
COPY Cargo.toml Cargo.lock rust-toolchain.toml clippy.toml ./
COPY .cargo .cargo
COPY crates crates
COPY apps/engine apps/engine
COPY xtask xtask
RUN cargo build --profile dist -p commitscape-engine \
  && mkdir -p /out/data/packs

FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=binary /src/target/dist/commitscape-engine /usr/local/bin/commitscape-engine
COPY --from=binary --chown=65532:65532 /out/data /data
ENV PORT=4100 PACK_DIR=/data/packs
VOLUME ["/data/packs"]
EXPOSE 4100
USER nonroot
HEALTHCHECK --interval=30s --timeout=5s CMD ["/usr/local/bin/commitscape-engine", "health"]
ENTRYPOINT ["/usr/local/bin/commitscape-engine"]
