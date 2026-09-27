#!/usr/bin/env bash
set -euo pipefail
version=$1; sums=$2
repo=${COMMITSCAPE_REPO:-pixelactstudio/commitscape}
hash=$(awk '$2 == "commitscape-win32-x64.zip" { print $1 }' "$sums")
cat <<JSON
{
  "version": "$version",
  "description": "Reads a git repository and shows what changes what you do next.",
  "homepage": "https://github.com/$repo",
  "license": "MIT|Apache-2.0",
  "architecture": {
    "64bit": {
      "url": "https://github.com/$repo/releases/download/v$version/commitscape-win32-x64.zip",
      "hash": "$hash"
    }
  },
  "bin": "commitscape.exe",
  "checkver": "github",
  "autoupdate": {
    "architecture": {
      "64bit": {
        "url": "https://github.com/$repo/releases/download/v\$version/commitscape-win32-x64.zip"
      }
    }
  }
}
JSON
