#!/bin/sh
set -eu

run_check() {
  name="$1"
  shift

  printf '\n==> %s\n' "$name"
  "$@"
}

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL must point to the restored staging/recovery database." >&2
  exit 1
fi

echo "Running restore drill checks against DATABASE_URL=${DATABASE_URL}"

run_check "Prisma schema validation" npm run prisma:validate
run_check "Prisma client generation" npm run prisma:generate
run_check "Backend TypeScript build" npm run build
run_check "Backend tests" npm test
run_check "Backend lint" npm run lint
run_check "Frontend typecheck" npm run web:typecheck
run_check "Frontend production build" npm run web:build
run_check "Formatting check" npm run format:check

if [ -n "${API_READINESS_URL:-}" ]; then
  run_check "API readiness endpoint" curl -fsS "$API_READINESS_URL"
else
  printf '\nSkipping API readiness endpoint check. Set API_READINESS_URL to enable it.\n'
fi

printf '\nRestore drill command checks completed.\n'
