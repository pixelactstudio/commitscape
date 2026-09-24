#!/usr/bin/env bash
# Writes the Homebrew formula for a release, from its SHA256SUMS: macOS and
# Linux, Intel and ARM, each from the release's prebuilt tarball.
#
#   scripts/homebrew-formula.sh <version> <SHA256SUMS> > commitscape.rb
#
# Put the result in a tap (a repository named homebrew-commitscape), and
# `brew install <owner>/commitscape/commitscape` installs it.
set -euo pipefail
version=$1; sums=$2
repo=${COMMITSCAPE_REPO:-OWNER/commitscape}
sum() { awk -v f="commitscape-$1.tar.gz" '$2 == f { print $1 }' "$sums"; }
url() { echo "https://github.com/$repo/releases/download/v$version/commitscape-$1.tar.gz"; }
cat <<RUBY
class Commitscape < Formula
  desc "Reads a git repository and shows what changes what you do next"
  homepage "https://github.com/$repo"
  version "$version"
  license any_of: ["MIT", "Apache-2.0"]

  on_macos do
    on_arm do
      url "$(url darwin-arm64)"
      sha256 "$(sum darwin-arm64)"
    end
    on_intel do
      url "$(url darwin-x64)"
      sha256 "$(sum darwin-x64)"
    end
  end

  on_linux do
    on_arm do
      url "$(url linux-arm64)"
      sha256 "$(sum linux-arm64)"
    end
    on_intel do
      url "$(url linux-x64-musl)"
      sha256 "$(sum linux-x64-musl)"
    end
  end

  def install
    bin.install "commitscape"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/commitscape --version")
  end
end
RUBY
