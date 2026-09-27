#!/bin/sh
# The real commitscape, except that acme/slow never finishes (the Builder's
# time limit is what ends it), and `health`, which asks the real GitHub,
# answers as a repository whose issues are answered in three and a half hours.
case "$*" in
  *acme/slow*) sleep 60 ;;
  health*) echo '{"answers":{"answered":12,"typical_hours":3.5}}'; exit 0 ;;
esac
exec "$COMMITSCAPE_REAL" "$@"
