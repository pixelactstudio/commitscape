#!/usr/bin/env bash
set -euo pipefail
version=$1; sums=$2
repo=${COMMITSCAPE_REPO:-pixelactstudio/commitscape}
sum() { awk -v f="commitscape-$1.tar.gz" '$2 == f { print $1 }' "$sums"; }
url() { echo "https://github.com/$repo/releases/download/v$version/commitscape-$1.tar.gz"; }
cat <<PKGBUILD
pkgname=commitscape-bin
pkgver=$version
pkgrel=1
pkgdesc="Reads a git repository's history and shares what each person built there"
arch=('x86_64' 'aarch64')
url="https://github.com/$repo"
license=('MIT' 'Apache-2.0')
optdepends=('git: to clone repositories' 'github-cli: to read GitHub pull requests and issues')
provides=('commitscape')
conflicts=('commitscape')
source_x86_64=("commitscape-\${pkgver}-x86_64.tar.gz::$(url linux-x64-musl)")
source_aarch64=("commitscape-\${pkgver}-aarch64.tar.gz::$(url linux-arm64)")
sha256sums_x86_64=('$(sum linux-x64-musl)')
sha256sums_aarch64=('$(sum linux-arm64)')

package() {
  install -Dm755 commitscape "\$pkgdir/usr/bin/commitscape"
  install -Dm644 LICENSE-MIT "\$pkgdir/usr/share/licenses/\$pkgname/LICENSE-MIT"
  install -Dm644 LICENSE-APACHE "\$pkgdir/usr/share/licenses/\$pkgname/LICENSE-APACHE"
}
PKGBUILD
