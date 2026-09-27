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
          # (ADR-0010), from the pnpm workspace (ADR-0013): only the local
          # page and the packages it imports.
          pnpm = pkgs.pnpm_12;
          fs = pkgs.lib.fileset;
          web = pkgs.stdenv.mkDerivation (finalAttrs: {
            pname = "commitscape-web";
            inherit version;
            src = fs.toSource {
              root = ./.;
              fileset = fs.unions [
                ./package.json
                ./pnpm-lock.yaml
                ./pnpm-workspace.yaml
                ./tsconfig.base.json
                ./apps/local
                ./packages
              ];
            };
            nativeBuildInputs = [
              pkgs.nodejs
              pkgs.pnpmConfigHook
              pnpm
            ];
            pnpmWorkspaces = [ "@commitscape/local..." ];
            pnpmDeps = pkgs.fetchPnpmDeps {
              inherit (finalAttrs) pname version src pnpmWorkspaces;
              inherit pnpm;
              fetcherVersion = 4;
              hash = "sha256-ykQelAFS4rCjRvickLpjfNO8TpqEwX0ezOu4k09CTJU=";
            };
            # Playwright's browsers are for the tests, which are not run here.
            env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
            buildPhase = "pnpm --filter @commitscape/local build";
            installPhase = "cp -r apps/local/dist $out";
          });
          commitscape = pkgs.rustPlatform.buildRustPackage {
            pname = "commitscape";
            inherit version;
            src = self;
            cargoLock.lockFile = ./Cargo.lock;
            # What is shipped (Decision 36): the release build, stripped.
            buildType = "dist";
            cargoBuildFlags = [
              "-p"
              "commitscape"
            ];
            preBuild = ''
              rm -rf apps/local/dist
              mkdir -p apps/local
              cp -r ${web} apps/local/dist
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
