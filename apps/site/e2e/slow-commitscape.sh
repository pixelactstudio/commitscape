#!/bin/sh
case "$*" in
  *acme/slow*) sleep 60 ;;
  health*) echo '{"answers":{"answered":12,"typical_hours":3.5}}'; exit 0 ;;
esac
exec "$COMMITSCAPE_REAL" "$@"
