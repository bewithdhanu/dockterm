# macOS distribution (without paying Apple)

Apple does **not** offer a free way for a downloaded `.dmg` / `.app` to open like a notarized app. Developer ID + notarization requires the [Apple Developer Program](https://developer.apple.com/programs/) ($99/year). SignPath and similar services still need that membership — they only host the certificate.

For an open-source project that will not pay that fee, use the paths below.

## What end users should do (no Terminal)

After installing from a GitHub release:

1. Open **DockTerm** once (macOS may say it cannot verify the developer, or that it was blocked).
2. Click **Done** / close the dialog — do **not** Move to Trash.
3. Open **System Settings → Privacy & Security**.
4. Scroll to **Security** and click **Open Anyway** next to DockTerm.
5. Confirm. After that, DockTerm launches normally on that Mac.

This is Apple’s supported path for unsigned software. No `xattr`, no Homebrew quarantine flags.

Re-installing or upgrading a new unsigned build may ask for **Open Anyway** again.

## Better free install options

| Path | Who it’s for | Gatekeeper |
| --- | --- | --- |
| **Privacy & Security → Open Anyway** | Anyone using a release DMG/ZIP | One-time GUI approval |
| **Clone + `npm run desktop`** | Developers | Built locally — usually fine |
| **Windows / Linux installers** | Non-Mac users | No Apple Gatekeeper |
| **Homebrew cask (unsigned)** | Brew users | Still needs Open Anyway on modern macOS |

A Homebrew **formula that builds from source** can avoid Gatekeeper (local build), but Electron apps are heavy to compile; a cask of our prebuilt DMG does not remove the Open Anyway step.

## Optional: paid notarization (double-click, no prompts)

If you later join the Developer Program (or a sponsor signs for you), CI already supports it. Add these secrets, then tag a release:

| Secret | Value |
| --- | --- |
| `CSC_LINK` | Base64 of the Developer ID `.p12` (`base64 -i cert.p12 \| pbcopy`) |
| `CSC_KEY_PASSWORD` | Password used when exporting the `.p12` |
| `APPLE_ID` | Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password |
| `APPLE_TEAM_ID` | Team ID (e.g. `A1B2C3D4E5`) |

- **Secrets present** → signed + notarized macOS artifacts  
- **Secrets missing** → unsigned builds still publish; users use **Open Anyway**

```bash
export CSC_LINK="$(base64 -i DeveloperID.p12)"
export CSC_KEY_PASSWORD='…'
export APPLE_ID='you@example.com'
export APPLE_APP_SPECIFIC_PASSWORD='xxxx-xxxx-xxxx-xxxx'
export APPLE_TEAM_ID='A1B2C3D4E5'
npm run dist:mac
```

Use `SKIP_NOTARIZE=1` only for local packaging tests without uploading to Apple.
