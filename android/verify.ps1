$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$projectRoot = Split-Path -Parent $PSScriptRoot
$apkPath = Join-Path $PSScriptRoot 'dist/mosque-display-tv.apk'
$build = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'dist/build-report.json') -Raw | ConvertFrom-Json
$apkHash = (Get-FileHash -LiteralPath $apkPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($apkHash -ne $build.sha256) { throw 'APK differs from the signed build report.' }
$archive = [System.IO.Compression.ZipFile]::OpenRead($apkPath)
try {
  function Read-ApkBytes([string]$name) {
    $entry = $archive.GetEntry($name)
    if (-not $entry) { throw "Missing APK entry: $name" }
    $stream = $entry.Open()
    $memory = [System.IO.MemoryStream]::new()
    try { $stream.CopyTo($memory); return ,$memory.ToArray() } finally { $stream.Dispose(); $memory.Dispose() }
  }
  function Byte-Hash([byte[]]$bytes) {
    $hash = [System.Security.Cryptography.SHA256]::Create()
    try { return [System.BitConverter]::ToString($hash.ComputeHash($bytes)).Replace('-','').ToLowerInvariant() } finally { $hash.Dispose() }
  }
  $names = @($archive.Entries | ForEach-Object { $_.FullName })
  if ($names | Where-Object { $_.Contains('\') }) { throw 'Invalid Windows separators in APK ZIP entries.' }
  foreach ($required in @('AndroidManifest.xml','resources.arsc','classes.dex','assets/web/index.html','assets/update-config.json','assets/phone.html','assets/web/licenses/qrcodegen-MIT.txt','assets/web/licenses/adhan-MIT.txt','assets/web/licenses/hijridate-MIT.txt','assets/web/DATA_SOURCES.md','assets/web/ANDROID_SOURCES_LICENSES.md','assets/web/assets/fonts/OFL.txt')) {
    if ($names -notcontains $required) { throw "Required APK entry missing: $required" }
  }
  if ($names | Where-Object { $_ -match '\.(p12|jks|keystore)$|password\.txt|^\.android-tools/' }) { throw 'Private signing or developer files leaked into APK.' }
  $dex = Read-ApkBytes 'classes.dex'
  if ([System.Text.Encoding]::ASCII.GetString($dex,0,4) -ne "dex`n") { throw 'Invalid DEX header.' }
  $packedHtml = [System.Text.Encoding]::UTF8.GetString((Read-ApkBytes 'assets/web/index.html'))
  $sourceHtml = Get-Content -LiteralPath (Join-Path $projectRoot 'index.html') -Raw -Encoding UTF8
  $pattern = '<script id="application-code">([\s\S]*?)</script>'
  if ([regex]::Match($packedHtml,$pattern).Groups[1].Value -cne [regex]::Match($sourceHtml,$pattern).Groups[1].Value) { throw 'Core application code changed while packaging.' }
  $packedBridge = [regex]::Match($packedHtml,'<script id="android-tv-bridge">([\s\S]*?)</script>').Groups[1].Value.Trim()
  if ($packedBridge -cne (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'tv-bridge.js') -Raw -Encoding UTF8).Trim()) { throw 'TV bridge differs from its tested source.' }
  if ((Byte-Hash (Read-ApkBytes 'assets/web/ANDROID_SOURCES_LICENSES.md')) -ne (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'SOURCES_LICENSES.md') -Algorithm SHA256).Hash.ToLowerInvariant()) { throw 'APK license/source notes are stale.' }
  $jsonCount = 0
  $data = @{}
  foreach ($match in [regex]::Matches($packedHtml,'<script id="([^"]+)" type="application/json">([\s\S]*?)</script>')) {
    $data[$match.Groups[1].Value] = $match.Groups[2].Value | ConvertFrom-Json
    $jsonCount++
  }
  if ($jsonCount -ne 6 -or $data['prayer-data'].records.Count -ne 732) { throw 'Embedded schedule/data coverage missing.' }
  $enabled = @($data['slides-data'] | Where-Object { $_.visible -ne $false -and $_.type -eq 'text' })
  if ($enabled.Count -ne 18) { throw 'Requested adhkar are missing.' }
  $qrHash = Byte-Hash (Read-ApkBytes 'assets/web/assets/announcements/donation-qr.jpg')
  if ($qrHash -ne (Get-FileHash -LiteralPath (Join-Path $projectRoot 'assets/announcements/donation-qr.jpg') -Algorithm SHA256).Hash.ToLowerInvariant()) { throw 'Donation QR changed in APK.' }
  if ($build.badging -notmatch "package: name='sa.mosque.display'" -or $build.badging -notmatch 'leanback-launchable-activity:') { throw 'TV launcher or package missing.' }
  if ($build.badging -notmatch "versionCode='7'" -or $build.badging -notmatch "versionName='2.1.0'" -or $build.manifestTree -notmatch 'android.intent.category.HOME' -or $build.manifestTree -notmatch 'android.intent.category.DEFAULT') { throw 'Updated HOME candidate filter/version missing.' }
  $permissions = @([regex]::Matches($build.badging,"uses-permission: name='([^']+)'") | ForEach-Object {$_.Groups[1].Value})
  $expectedPermissions = @('android.permission.INTERNET','android.permission.ACCESS_NETWORK_STATE','android.permission.REQUEST_INSTALL_PACKAGES')
  if (@(Compare-Object $expectedPermissions $permissions).Count -ne 0) { throw 'Unexpected app permission set.' }
  $updateConfig = [System.Text.Encoding]::UTF8.GetString((Read-ApkBytes 'assets/update-config.json')) | ConvertFrom-Json
  if ($updateConfig.owner -ne 'adel2184' -or $updateConfig.repository -ne 'mosque-tv' -or $updateConfig.metadataAsset -ne 'update.json') { throw 'Wrong update repository.' }
  if ($build.signatureVerification -notmatch 'Verified using v2 scheme.*true' -or $build.signatureVerification -notmatch 'Verified using v3 scheme.*true') { throw 'Signature verification did not pass.' }
  if ($build.signatureVerification -notmatch 'Signer #1 certificate SHA-256 digest: 4cb9564d63fd3f037d12e2ed98af1bf7255a7fb7ef53d6a57aba020b5e9b061e') { throw 'Signing identity changed; upgrade would not preserve installed app.' }
  $result = [ordered]@{
    verifiedAt = [DateTime]::UtcNow.ToString('o'); apkSHA256 = $apkHash; apkBytes = (Get-Item -LiteralPath $apkPath).Length
    entryCount = $names.Count; minSdk = $build.minSdk; targetSdk = $build.targetSdk; versionCode = 7; tvLauncher = $true; homeCandidate = $true
    requestedPermissions = $permissions; updateRepository = 'adel2184/mosque-tv'; signatureV2 = $true; signatureV3 = $true; originalSigningIdentity = $true; coreScriptUnchanged = $true; tvBridgeMatchesSource = $true
    embeddedJsonBlocks = $jsonCount; prayerRecords = 732; adhkar = $enabled.Count; originalQrSHA256 = $qrHash
    licensesIncluded = $true; privateSigningFilesIncluded = $false
    deviceTests = 'NOT RUN: no TV or emulator connected. This audit checks package contents and build verification only.'
  }
  $result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'dist/package-audit.json') -Encoding utf8
  $result | ConvertTo-Json -Depth 6
} finally { $archive.Dispose() }
