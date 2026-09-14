# macOS signing & notarization

DockTerm’s CI already supports **Developer ID** signing + **notarization**. When the secrets below are set, release builds open with a double-click (no Open Anyway). Without them, CI falls back to **ad-hoc** signing (Open Anyway once).

## What you need (Apple Developer Program)

| Item | Purpose |
| --- | --- |
| **Developer ID Application** certificate | Sign the `.app` for distribution outside the Mac App Store |
| Exported **`.p12`** + password | CI imports the cert (`CSC_LINK` / `CSC_KEY_PASSWORD`) |
| **Apple ID** + **app-specific password** | Upload to Apple notary (`notarytool`) |
| **Team ID** | 10-character team id from Membership details |

> **Apple Development** certificates (what Xcode creates by default) are **not** enough for public DMG/ZIP downloads. You must create **Developer ID Application**.

## One-time setup

### 1. Create Developer ID Application cert

1. Open **Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority…**  
   Save a CSR to disk (email = your Apple ID, “Saved to disk”).
2. Go to [Certificates](https://developer.apple.com/account/resources/certificates/list) → **+**  
   Choose **Developer ID Application** → upload the CSR → download the `.cer` → double-click to install.
3. In Keychain Access, find **Developer ID Application: Your Name (TEAMID)** → right-click → **Export…** → `.p12` with a strong password.

### 2. App-specific password & Team ID

1. [appleid.apple.com](https://appleid.apple.com) → **Sign-In and Security** → **App-Specific Passwords** → generate one for “DockTerm CI”.
2. [developer.apple.com/account](https://developer.apple.com/account) → **Membership** → copy **Team ID**.

### 3. Push secrets to GitHub

```bash
chmod +x scripts/setup-apple-signing-secrets.sh
./scripts/setup-apple-signing-secrets.sh ~/Desktop/DeveloperID.p12
```

Or set manually:

| GitHub secret | Value |
| --- | --- |
| `CSC_LINK` | `base64 -i DeveloperID.p12 \| tr -d '\n'` |
| `CSC_KEY_PASSWORD` | Password used when exporting the `.p12` |
| `APPLE_ID` | Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password |
| `APPLE_TEAM_ID` | Team ID (e.g. `A1B2C3D4E5`) |

```bash
gh secret list -R bewithdhanu/dockterm
```

### 4. Ship a signed release

Tag a version (`v1.x.x`). The **Build desktop apps** workflow signs + notarizes macOS artifacts when `CSC_LINK` is present.

## Local signed build (optional)

```bash
export CSC_LINK="$(base64 -i ~/Desktop/DeveloperID.p12 | tr -d '\n')"
export CSC_KEY_PASSWORD='…'
export APPLE_ID='you@example.com'
export APPLE_APP_SPECIFIC_PASSWORD='xxxx-xxxx-xxxx-xxxx'
export APPLE_TEAM_ID='A1B2C3D4E5'
npm run dist:mac
```

Use `SKIP_NOTARIZE=1` only to skip Apple upload while testing packaging.

## Verify a build

```bash
codesign -dv --verbose=4 /path/to/DockTerm.app
# Expect: Authority=Developer ID Application: …
spctl --assess --verbose=2 --type execute /path/to/DockTerm.app
# Expect: accepted
```

## Ad-hoc fallback (no secrets)

If `CSC_LINK` is unset, CI ad-hoc signs (`identity: "-"`). Users may need **System Settings → Privacy & Security → Open Anyway** once. That avoids the broken “damaged / Move to Trash” dialog.

## Support the project

Notarization costs are covered by your Apple Developer membership. Extra support is welcome on [Ko-fi](https://ko-fi.com/bewithdhanu).
