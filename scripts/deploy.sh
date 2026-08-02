#!/usr/bin/env bash
# Manual deploy of the AeroFlow studio app to an S3 bucket behind CloudFront.
#
# Use this for a local deploy with your own AWS credentials. The GitHub Actions
# workflow (.github/workflows/deploy.yml) does the same thing on push to main
# once the repo secrets are set.
#
# Prereqs: AWS CLI configured with credentials that can write the bucket and
# invalidate the distribution.
#
# Usage:
#   BUCKET=my-bucket DIST_ID=EXXXXXXXX ./scripts/deploy.sh
# or set AEROFLOW_S3_BUCKET / AEROFLOW_CF_DISTRIBUTION_ID in your environment.
set -euo pipefail

BUCKET="${BUCKET:-${AEROFLOW_S3_BUCKET:-}}"
DIST_ID="${DIST_ID:-${AEROFLOW_CF_DISTRIBUTION_ID:-}}"

if [[ -z "$BUCKET" ]]; then
  echo "Set BUCKET or AEROFLOW_S3_BUCKET to the target bucket." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "Building…"
npm run build

echo "Syncing to s3://$BUCKET …"
aws s3 sync apps/studio/dist "s3://$BUCKET" \
  --delete --cache-control "public,max-age=31536000,immutable" \
  --exclude "index.html"
aws s3 cp apps/studio/dist/index.html "s3://$BUCKET/index.html" \
  --cache-control "no-cache"

if [[ -n "$DIST_ID" ]]; then
  echo "Invalidating CloudFront $DIST_ID …"
  aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" >/dev/null
  echo "Done."
else
  echo "Synced. Set DIST_ID to also invalidate CloudFront (else changes appear after cache TTL)."
fi
