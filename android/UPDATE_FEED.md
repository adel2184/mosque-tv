# Native update feed (schema 1)

`android/update-config.json` is copied to the APK asset root as `update-config.json`.
The current public repository is `adel2184/mosque-tv`. Blank `owner`/`repository`
explicitly disable updates; no check runs on startup.
Set them to the public GitHub repository that publishes this app. The updater reads
`https://api.github.com/repos/OWNER/REPOSITORY/releases/latest` and accepts only a
non-draft, non-prerelease release. `metadataAsset` defaults to `update.json`.

Attach `update.json`, `mosque-display-tv.apk` and `SHA256SUMS.txt` to the same
stable GitHub Release. The v2.5.2 feed generated from the signed APK is

```json
{
  "schemaVersion": 1,
  "packageName": "sa.mosque.display",
  "versionName": "2.5.2",
  "versionCode": 17,
  "minSdk": 24,
  "apk": {
    "name": "mosque-display-tv.apk",
    "size": 1657450,
    "sha256": "004b0c5cefca889edd4c9e6aa9e7a5e44cf9dcb65d79129c986b2e849c53ec81"
  }
}
```

The TV reads the attached `update.json`. Generate it after signing each APK and
verify both files against `SHA256SUMS.txt`. Keep versionName/code/minSdk
identical to the APK manifest. The app rejects equal or lower codes, another package,
another current signing certificate, an incompatible minSdk, truncated/oversized
downloads and hash mismatches. The hard maximum is 32 MiB, and config can lower it.
The signing key must remain private and must remain the same across releases.
No external signing service or runtime library is introduced.

A signing-certificate mismatch must leave the installed app in place. Never automate
uninstallation to work around it. Obtain an APK signed with the original key. Any
later consideration of manual removal requires exporting recoverable settings first
and clear operator approval; uninstalling removes the app's private local data.

Initial asset URLs must be HTTPS `github.com/OWNER/REPOSITORY/releases/download/TAG/NAME`
from the GitHub release response. Redirects may continue only to the same original
URL or exact GitHub release CDN hosts `release-assets.githubusercontent.com` and
`objects.githubusercontent.com`. TLS uses Android's normal certificate verification.
Metadata has a 64 KiB limit, release API JSON 512 KiB, and network calls are bounded
and cancellable. No token or private-repository credentials are stored.

Integration: instantiate `UpdateManager(Activity, Host)`, forward `onResume`,
`onActivityResult`, and `destroy`; expose only `status/check/install/cancel` to the
trusted local page. `Host.canStartUpdate()` must return false during the prayer
screen and when the Activity is not interactive. Callbacks arrive on the UI thread.
The explicit install tap first opens Android's per-source permission settings if
needed. PackageInstaller then reports `pending_confirmation`; a second install tap
opens Android's confirmation screen. The receiver never launches UI in background.
If Android kills/recreates the app before confirmation, another explicit tap
reverifies the cached file and recreates the session. No automatic install follows
permission grant, network reconnect, resume, or boot.

Manifest additions required: `INTERNET`, `REQUEST_INSTALL_PACKAGES`, and
`<receiver android:name=".UpdateInstallReceiver" android:exported="false" />`.
No storage, boot, accessibility, root or ADB permission is required. Installation
still depends on the TV firmware offering its standard install-source and install
confirmation screens; real TV testing remains necessary. API24/25 use Android's
existing unknown-source policy. PackageInstaller performs the final platform
verification and keeps the existing application data on an accepted update.

Only one private cached APK and one partial file are used. A manual cancel abandons
our session where Android permits it; it never uninstalls the current package.
Cancellation cannot roll back an update Android has already accepted. Preferences
record pending code/session/result so a newly replaced app can report completion.

Primary Android references checked for this implementation:

- [PackageInstaller session commit](https://developer.android.com/reference/android/content/pm/PackageInstaller.Session#commit(android.content.IntentSender))
- [Pending user action](https://developer.android.com/reference/android/content/pm/PackageInstaller#STATUS_PENDING_USER_ACTION)
- [Per-source package install authorization](https://developer.android.com/reference/android/content/pm/PackageManager#canRequestPackageInstalls())

Verification: `node android/test-update.cjs` tests the Android-free URL, repository,
version, SDK, bounds, hash-format and signer-comparison rules. Host compilation
checks API usage; neither check substitutes for TV installation/permission testing.
