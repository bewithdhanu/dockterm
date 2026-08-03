# macOS distribution (unsigned OK)

DockTerm ships **ad-hoc signed** macOS builds by default (no Apple Developer fee). That is intentional.

## What users see (not an error)

After install, macOS may say Apple could not verify DockTerm, or block the first open. That is a **warning**, not corruption. Do **not** Move to Trash.

1. Dismiss the dialog (**Done**).
2. Open **System Settings → Privacy & Security**.
3. Click **Open Anyway** next to DockTerm.
4. Confirm. Later launches are normal.

| Dialog | Meaning | Action |
| --- | --- | --- |
| “Apple could not verify…” / blocked + **Open Anyway** | Expected for unsigned releases | Allow once in Settings |
| “is damaged… Move to Trash” | Bad build (missing ad-hoc signature) | Re-download a newer release — do not assume the file is corrupt |

## Why ad-hoc signing

On Apple Silicon, a completely unsigned `.app` downloaded from the internet often triggers the unrecoverable **damaged / Move to Trash** dialog. Ad-hoc signing (`codesign` identity `-`) seals the bundle so Gatekeeper uses the bypassable path above.

## Optional: paid notarization (no prompts)

If you later join the [Apple Developer Program](https://developer.apple.com/programs/) ($99/year), add these secrets and tag a release. CI will Developer ID–sign and notarize instead of ad-hoc:

| Secret | Value |
| --- | --- |
| `CSC_LINK` | Base64 of the Developer ID `.p12` (`base64 -i cert.p12 \| pbcopy`) |
| `CSC_KEY_PASSWORD` | Password used when exporting the `.p12` |
| `APPLE_ID` | Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password |
| `APPLE_TEAM_ID` | Team ID (e.g. `A1B2C3D4E5`) |

```bash
export CSC_LINK="$(base64 -i DeveloperID.p12)"
export CSC_KEY_PASSWORD='…'
export APPLE_ID='you@example.com'
export APPLE_APP_SPECIFIC_PASSWORD='xxxx-xxxx-xxxx-xxxx'
export APPLE_TEAM_ID='A1B2C3D4E5'
npm run dist:mac
```

Use `SKIP_NOTARIZE=1` only for local packaging tests without uploading to Apple.
