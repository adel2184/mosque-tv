# Development

[العربية](../README.md) · [English overview](../README_EN.md) · [Contributing](../CONTRIBUTING.md)

## Build and preview the web app

Use Node.js 24 or 26. From the repository root:

```sh
git clone https://github.com/adel2184/mosque-tv.git
cd mosque-tv
node dev/build.cjs
node dev/check-package.cjs
```

The web build uses bundled dependencies and data; it needs no `npm install` or network connection once the repository is downloaded. It regenerates `index.html`, `data/location-catalog.json` and `assets/data/location-catalog.js` from the tracked sources. The two catalog outputs are intentionally ignored by Git, so run the build before opening a fresh source checkout.

Open `index.html` in a modern desktop browser, keeping `assets/` beside it. Use the settings button or **Ctrl + ,** and the browser's fullscreen command. Keep the same browser profile and location for storage, and export settings to JSON before moving files. A prepared release bundle already includes its runtime assets.

To preview the TV control center locally:

```sh
node dev/preview-tv.cjs
```

Open [the local TV preview](http://127.0.0.1:8123/index.html?test=1). This development server injects the real JavaScript TV bridge with mock native functions and a fixed demonstration clock. It does not change Android settings, install updates or demonstrate real device performance. Stop it with **Ctrl + C**.

## Source map

| Path | Purpose |
| --- | --- |
| `dev/shell.html`, `dev/app.js` | Display layout, prayer states and mosque settings. |
| `dev/control-center.*`, `dev/setup-wizard.*`, `dev/locale.*` | Remote navigation, first setup and interface languages. |
| `dev/location-engine.js`, `dev/setup-provider.js` | Local prayer calculation and optional external timetable parsing. |
| `dev/profile-store.js`, `dev/profile-adapter.js` | Saved profile and its integration with the display. |
| `data/`, `dev/vendor/`, `assets/`, `licenses/` | Timetables, calendar, bundled dependencies, images and attribution. |
| `android/src/`, `android/tv-bridge.js` | Android TV host and native device features. |
| `services/reports/`, `optimize/` | Optional owner-operated reports service and local reporting tools. |
| `.github/workflows/` | Automated checks and signed-release workflow. |

Edit the files under `dev/` and rebuild; changes made only to generated `index.html` will be overwritten. Timetable provenance and calendar limits are documented in [data sources](../DATA_SOURCES.md) and [location sources](LOCATION_SOURCES_AR.md).

## Validate changes

After rebuilding, run the checks relevant to the change. For example:

```sh
node dev/check-package.cjs
node dev/test-content.cjs
node dev/test-location-engine.cjs
node dev/test-setup-wizard.cjs
node dev/test-locale.cjs
node android/test-control-center.cjs
```

The full maintained command list is in [Checks](../.github/workflows/checks.yml). Some native-rule tests compile Java and require JDK 17. Open `test.html` for browser acceptance checks, and inspect both interface languages at the intended display size.

Record which version, browser or TV was tested. Node tests and browser previews do not establish WebView compatibility, native permissions, OTA installation, cold boot, long-running stability or astronomical approval of prayer times. See the [TV verification report](../android/TEST_REPORT_TV.md) for the scope of recorded device tests.

## Refresh README screenshots

With Playwright and Sharp available in your development tooling environment and Chrome installed, run:

```sh
node dev/capture-readme.cjs
```

You can pass the path to another Chromium browser as the first argument. The script uses an ephemeral demo profile, a fixed demonstration clock, and simulated Android functions; it writes the five WebP previews to `docs/images/` without changing operational settings. Review images before publishing and retain the browser-preview caption. These optional tools are not required to build or run the app.

## Build the Android APK

The Android build runs on **Windows** using Node.js 24 or 26, JDK 17, Android SDK Platform 37.2, Build Tools 37.0.0 and PowerShell. The manifest retains target API 35 and minimum API 24. Set `JAVA_HOME` and `ANDROID_HOME` for these installations and configure the builder from the repository root.

```powershell
$env:MOSQUE_JAVA_HOME = $env:JAVA_HOME
$env:MOSQUE_BUILD_TOOLS = Join-Path $env:ANDROID_HOME 'build-tools/37.0.0'
$env:MOSQUE_ANDROID_JAR = Join-Path $env:ANDROID_HOME 'platforms/android-37.2/android.jar'
$env:MOSQUE_RELEASE = '1'
node dev/build.cjs
node android/build.cjs
pwsh -File android/verify.ps1
node android/release.cjs
```

The release build reads the original signing files from `.android-signing/` or from the directory named by `MOSQUE_RELEASE_SIGNING_DIR`. It stops if the original key is unavailable. Keep signing files and passwords outside source control. The verified APK and its `SHA256SUMS.txt` go in `android/dist/`.

For a development build, leave `MOSQUE_RELEASE` unset (or run `Remove-Item Env:MOSQUE_RELEASE -ErrorAction SilentlyContinue` in the same PowerShell session), then run `node dev/build.cjs` and `node android/build.cjs`. The builder uses a separate development key under `.android-signing/development/` and writes its APK to `android/build/development-dist/`. Test it on a separate device or emulator. An installed release accepts updates signed with its original certificate.

Release CI uses Node.js 26.13.1. The signing workflow accepts a protected `vX.Y.Z` tag matching the Android manifest and checks that its commit belongs to the default branch history. For manual dispatch, select the protected tag as the workflow ref and enter the same name. A tag push also requires the repository variable `RELEASE_SIGNING_ENABLED=true`. The checks workflow must pass before the protected `release-signing` environment supplies the signing secrets.

For release ownership, versioning and CI signing, follow the [release guide](RELEASE_AR.md) and [release workflow](../.github/workflows/release.yml). The television itself needs only the APK.
