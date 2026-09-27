{
  description = "commitscape: reads a git repository and shows what changes what you do next";

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
          commitscape = pkgs.rustPlatform.buildRustPackage {
            pname = "commitscape";
            inherit version;
            src = self;
            cargoLock.lockFile = ./Cargo.lock;
            buildType = "dist";
            cargoBuildFlags = [
              "-p"
              "commitscape"
            ];
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
          inherit commitscape;
          default = commitscape;
        }
      );
    };
}
