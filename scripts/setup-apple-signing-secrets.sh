#!/usr/bin/env bash
# Prepare GitHub Actions secrets for Developer ID signing + notarization.
#
# Prerequisites (do these once in Apple Developer / Keychain):
# 1. Create a Certificate Signing Request in Keychain Access
# 2. At https://developer.apple.com/account/resources/certificates/list
#    create **Developer ID Application** (not “Apple Development”)
# 3. Download/install the .cer, then in Keychain: export that identity as .p12
# 4. Create an app-specific password: https://appleid.apple.com → Sign-In and Security
# 5. Note your Team ID: https://developer.apple.com/account → Membership
#
# Usage:
#   ./scripts/setup-apple-signing-secrets.sh /path/to/DeveloperID.p12
#
set -euo pipefail

REPO="${GITHUB_REPOSITORY:-bewithdhanu/dockterm}"
P12="${1:-}"

if [[ -z "${P12}" || ! -f "${P12}" ]]; then
  echo "Usage: $0 /path/to/DeveloperID-Application.p12"
  echo
  echo "Current codesigning identities on this Mac:"
  security find-identity -v -p codesigning || true
  echo
  echo "You need an identity named like:"
  echo '  "Developer ID Application: Your Name (TEAMID)"'
  echo "Apple Development: … is NOT enough for Gatekeeper-clean downloads."
  exit 1
fi

if ! command -v gh >/dev/null; then
  echo "Install GitHub CLI (gh) first."
  exit 1
fi

echo "Repo: ${REPO}"
echo "P12:  ${P12}"
echo

read -r -s -p "P12 export password (CSC_KEY_PASSWORD): " CSC_KEY_PASSWORD
echo
read -r -p "Apple ID email (APPLE_ID): " APPLE_ID
read -r -s -p "App-specific password (APPLE_APP_SPECIFIC_PASSWORD): " APPLE_APP_SPECIFIC_PASSWORD
echo
read -r -p "Team ID (APPLE_TEAM_ID, 10 chars): " APPLE_TEAM_ID
echo

CSC_LINK="$(base64 < "${P12}" | tr -d '\n')"

echo "Setting secrets on ${REPO}…"
printf '%s' "${CSC_LINK}" | gh secret set CSC_LINK -R "${REPO}"
printf '%s' "${CSC_KEY_PASSWORD}" | gh secret set CSC_KEY_PASSWORD -R "${REPO}"
printf '%s' "${APPLE_ID}" | gh secret set APPLE_ID -R "${REPO}"
printf '%s' "${APPLE_APP_SPECIFIC_PASSWORD}" | gh secret set APPLE_APP_SPECIFIC_PASSWORD -R "${REPO}"
printf '%s' "${APPLE_TEAM_ID}" | gh secret set APPLE_TEAM_ID -R "${REPO}"

echo
echo "Done. Next tagged release (v*) will Developer ID–sign and notarize on macOS CI."
echo "Verify secrets: gh secret list -R ${REPO}"
