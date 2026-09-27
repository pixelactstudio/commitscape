#!/usr/bin/env bash
set -euo pipefail
bin=$1; repo=$2; count=${3:-200}; next=${4:-3}
flagged=0; fixed=0
mapfile -t commits < <(git -C "$repo" log --no-merges --first-parent --format='%H %ae' -n "$count")
for ((i = ${#commits[@]} - 1; i >= 0; i--)); do
  read -r sha email <<<"${commits[$i]}"
  found=$("$bin" check "$repo" --commit "$sha" --format json 2>/dev/null |
    jq -r '.forgotten[] | select(.folder | not) | "\(.missing)\t\(.because)\t\(.together)/\(.of)"') || continue
  [[ -z $found ]] && continue
  later=()
  for ((j = i - 1; j >= 0 && ${#later[@]} < next; j--)); do
    read -r s e <<<"${commits[$j]}"
    [[ $e == "$email" ]] && later+=("$s")
  done
  while IFS=$'\t' read -r missing because evidence; do
    flagged=$((flagged + 1))
    for s in "${later[@]}"; do
      if git -C "$repo" diff-tree --no-commit-id --name-only -r "$s" | grep -qxF "$missing"; then
        fixed=$((fixed + 1))
        echo "$(git -C "$repo" log -1 --format='%h %ad %s' --date=short "$sha")"
        echo "    changed $because but not $missing ($evidence); $(git -C "$repo" log -1 --format='%h %ad %s' --date=short "$s")"
        break
      fi
    done
  done <<<"$found"
done
echo "flagged $flagged files in ${#commits[@]} commits; $fixed were changed by the same author within their next $next commits"
