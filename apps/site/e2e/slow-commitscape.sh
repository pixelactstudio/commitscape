#!/bin/sh
for last; do :; done
if [ "$1" = report ] && [ -d "$last" ] && git -C "$last" remote get-url origin 2>/dev/null | grep -q 'acme/slow'; then sleep 60; fi
exec "$COMMITSCAPE_REAL" "$@"
