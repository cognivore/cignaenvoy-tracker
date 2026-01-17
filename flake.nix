{
  description = "Cigna Envoy document tracker with LLM + local-first DB";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      ...
    }:
    flake-utils.lib.eachSystem [ "x86_64-linux" "aarch64-darwin" "x86_64-darwin" ] (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
        lib = pkgs.lib;
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs =
            with pkgs;
            [
              nodejs
              pnpm
              sqlite
              jq
              curl
              git
              caddy
            ]
            ++ lib.optionals stdenv.isLinux [
              chromedriver
              chromium
              xvfb-run
            ]
            ++ lib.optionals stdenv.isDarwin [
              chromedriver
            ];
        };

        devShell = self.devShells.${system}.default;
      }
    );
}
