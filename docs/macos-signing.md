# macOS signing & notarization (Gatekeeper-ready releases)

End users should never need Terminal commands. For DockTerm `.dmg` / `.app` downloads to open like a normal Mac app, releases must be:

1. Signed with a **Developer ID Application** certificate  
2. **Notarized** by Apple  
3. Stapled (electron-builder does this after notarize)

## What you need

- [Apple Developer Program](https://developer.apple.com/programs/) membership ($99/year)
- A **Developer ID Application** certificate (export as `.p12`)
- An [app-specific password](https://appleid.apple.com) for your Apple ID
- Your 10-character **Team ID** (Apple Developer → Membership)

## GitHub Actions secrets

Add these repository secrets on [bewithdhanu/dockterm](https://github.com/bewithdhanu/dockterm/settings/secrets/actions):

| Secret | Value |
| --- | --- |
| `CSC_LINK` | Base64 of the `.p12` file (`base64 -i cert.p12 \| pbcopy`) |
| `CSC_KEY_PASSWORD` | Password used when exporting the `.p12` |
| `APPLE_ID` | Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password |
| `APPLE_TEAM_ID` | Team ID (e.g. `A1B2C3D4E5`) |

## Pipeline behavior

- **Secrets present** → macOS jobs sign + notarize → users double-click and open  
- **Secrets missing** → unsigned build still uploads (CI stays green) but Gatekeeper will block downloads  

After secrets are set, cut a new tag (e.g. `v1.0.1`) so GitHub Actions publishes notarized installers.

## Local signed build (optional)

```bash
export CSC_LINK="$(base64 -i DeveloperID.p12)"
export CSC_KEY_PASSWORD='…'
export APPLE_ID='you@example.com'
export APPLE_APP_SPECIFIC_PASSWORD='xxxx-xxxx-xxxx-xxxx'
export APPLE_TEAM_ID='A1B2C3D4E5'
npm run dist:mac
```

Use `SKIP_NOTARIZE=1` only for local packaging tests without uploading to Apple.
