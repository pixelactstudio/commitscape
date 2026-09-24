{
  description = "commitscape: reads a git repository and shows what changes what you do next";

  # nixos-unstable: the workspace needs Rust 1.98 or later.
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAll = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
      version = (builtins.fromTOML (builtins.readFile ./Cargo.toml)).workspace.package.version;
    in
    {
      packages = forAll (
        pkgs:
        let
          # The browser interface, built once and embedded in the binary
          # (ADR-0010).
          web = pkgs.buildNpmPackage {
            pname = "commitscape-web";
            inherit version;
            src = ./web;
            npmDepsHash = "sha256-GJDoxs4AYdKsz4gKk60SDS4kodHed7ZHTYMKUqCxdEM=";
            # Playwright's browsers are for the tests, which are not run here.
            env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
            installPhase = "cp -r dist $out";
          };
          commitscape = pkgs.rustPlatform.buildRustPackage {
            pname = "commitscape";
            inherit version;
            src = self;
            cargoLock.lockFile = ./Cargo.lock;
            cargoBuildFlags = [
              "-p"
              "commitscape"
            ];
            preBuild = ''
              rm -rf web/dist
              cp -r ${web} web/dist
            '';
            # The tests read fixture repositories written with git by
            # `cargo xtask fixtures`; CI runs them.
            doCheck = false;
            meta = {
              description = "Reads a git repository and shows what changes what you do next";
              license = with pkgs.lib.licenses; [
                mit
                asl20
              ];
              mainProgram = "commitscape";
            };
          };
        in
        {
          inherit commitscape web;
          default = commitscape;
        }
      );
    };
}
