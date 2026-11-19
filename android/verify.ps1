$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$projectRoot = Split-Path -Parent $PSScriptRoot
[xml]$manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $PSScriptRoot 'AndroidManifest.xml')
$androidNs = 'http://schemas.android.com/apk/res/android'
$versionName = $manifest.DocumentElement.GetAttribute('versionName', $androidNs)
$versionCode = [int]$manifest.DocumentElement.GetAttribute('versionCode', $androidNs)
if ($versionName -notmatch '^\d+\.\d+\.\d+$' -or $versionCode -lt 1) { throw 'Invalid source version.' }
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
  foreach ($required in @('AndroidManifest.xml','resources.arsc','classes.dex','assets/web/index.html','assets/web/assets/data/location-catalog.js','assets/update-config.json','assets/phone.html','assets/web/licenses/qrcodegen-MIT.txt','assets/web/licenses/adhan-MIT.txt','assets/web/licenses/hijridate-MIT.txt','assets/web/licenses/geonames-CC-BY-4.0.txt','assets/web/licenses/geonames-NOTICE.txt','assets/web/licenses/Unicode-3.0.txt','assets/web/DATA_SOURCES.md','assets/web/ANDROID_SOURCES_LICENSES.md','assets/web/assets/fonts/OFL.txt')) {
    if ($names -notcontains $required) { throw "Required APK entry missing: $required" }
  }
  if ($names | Where-Object { $_ -match '\.(p12|jks|keystore)$|password\.txt|^\.android-tools/' }) { throw 'Private signing or developer files leaked into APK.' }
  foreach ($required in @('assets/device-profiles.json','assets/reports/index.html','assets/reports/report-form.js','assets/reports/report-schema.js','assets/reports/report.css','assets/web/licenses/CleanYourTV-MIT.txt','assets/web/licenses/CleanYourTV-NOTICE.txt')) {
    if ($names -notcontains $required) { throw "Required preparation/report entry missing: $required" }
  }
  $deviceProfilesBytes = Read-ApkBytes 'assets/device-profiles.json'
  $deviceProfilesHash = Byte-Hash $deviceProfilesBytes
  if ($deviceProfilesHash -ne (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'device-profiles.json') -Algorithm SHA256).Hash.ToLowerInvariant()) { throw 'Model catalogue changed in APK.' }
  $deviceProfiles = [System.Text.Encoding]::UTF8.GetString($deviceProfilesBytes) | ConvertFrom-Json
  if ($deviceProfiles.profiles.Count -ne 416 -or $deviceProfiles.source.commit -ne '3cd274f866b71ec15e4f7d8c796514b0baa8033c') { throw 'Pinned community model source mismatch.' }
  foreach ($file in @('index.html','report-form.js','report-schema.js','report.css')) {
    if ((Byte-Hash (Read-ApkBytes ('assets/reports/' + $file))) -ne (Get-FileHash -LiteralPath (Join-Path $projectRoot ('services/reports/public/' + $file)) -Algorithm SHA256).Hash.ToLowerInvariant()) { throw "Report UI differs from source: $file" }
  }
  $dex = Read-ApkBytes 'classes.dex'
  if ([System.Text.Encoding]::ASCII.GetString($dex,0,4) -ne "dex`n") { throw 'Invalid DEX header.' }
  if (-not [System.Text.Encoding]::ASCII.GetString($dex).Contains('https://mosque-tv-reports-adel2184.netlify.app/api/reports')) { throw 'Report receiver differs from the owner-selected service.' }
  $packedHtml = [System.Text.Encoding]::UTF8.GetString((Read-ApkBytes 'assets/web/index.html'))
  if ((Byte-Hash (Read-ApkBytes 'assets/phone.html')) -ne (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'phone.html') -Algorithm SHA256).Hash.ToLowerInvariant()) {
    throw 'Phone control page differs from its tested source.'
  }
  $policy = [regex]::Match($packedHtml, '<head>\s*<meta http-equiv="Content-Security-Policy" content="([^"]+)">').Groups[1].Value
  $scriptPolicy = [regex]::Match($policy, "(?:^|;\s*)script-src ([^;]+)").Groups[1].Value
  $expectedSources = @("'self'")
  foreach ($id in @('prayer-calculation-library','location-engine-code','profile-store-code','locale-code','setup-provider-code','android-tv-bridge','application-code')) {
    $blocks = [regex]::Matches($packedHtml, ('<script id="' + $id + '">([\s\S]*?)</script>'))
    if ($blocks.Count -ne 1) { throw "Missing or duplicate executable script in APK: $id" }
    $scriptText = $blocks[0].Groups[1].Value -replace "\r\n?", "`n"
    $digest = [System.Security.Cryptography.SHA256]::Create()
    try { $hash = [Convert]::ToBase64String($digest.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($scriptText))) } finally { $digest.Dispose() }
    $expectedSources += "'sha256-$hash'"
  }
  if (Compare-Object -CaseSensitive ($scriptPolicy -split '\s+') $expectedSources) { throw 'Script policy does not match trusted scripts in the signed APK.' }
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
  if ($jsonCount -ne 7 -or $data['prayer-data'].records.Count -ne 732) { throw 'Embedded schedule/data coverage missing.' }
  $packagedGuide = $data['display-content-data'].prayerGuide
  $sourceGuide = (Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $projectRoot 'dev/display-content.json') | ConvertFrom-Json).prayerGuide
  if (-not $packagedGuide -or $packagedGuide.postPrayer.Count -lt 1 -or
      ($packagedGuide | ConvertTo-Json -Depth 8 -Compress) -cne ($sourceGuide | ConvertTo-Json -Depth 8 -Compress)) {
    throw 'Offline prayer guide in APK differs from the verified source.'
  }
  if ($data['config-data'].silentPhoneReminder -ne $true -or $data['config-data'].postPrayerMinutes -ne 5) {
    throw 'Unexpected prayer reminder defaults in APK.'
  }
  $setupCalendar = $data['setup-calendar-data']
  if ($setupCalendar.rangeStart -ne '1924-08-01' -or $setupCalendar.rangeEnd -ne '2077-11-16' -or $setupCalendar.months.Count -ne 1897) { throw 'Complete local setup calendar missing.' }
  $catalogHash = Byte-Hash (Read-ApkBytes 'assets/web/assets/data/location-catalog.js')
  $catalogPath = Join-Path $projectRoot 'assets/data/location-catalog.js'
  if ($catalogHash -ne (Get-FileHash -LiteralPath $catalogPath -Algorithm SHA256).Hash.ToLowerInvariant()) { throw 'Bundled location catalog differs from the generated local asset.' }
  $enabled = @($data['slides-data'] | Where-Object { $_.visible -ne $false -and $_.type -eq 'text' })
  if ($enabled.Count -ne 18) { throw 'Requested adhkar are missing.' }
  $qrHash = Byte-Hash (Read-ApkBytes 'assets/web/assets/announcements/donation-qr.jpg')
  if ($qrHash -ne (Get-FileHash -LiteralPath (Join-Path $projectRoot 'assets/announcements/donation-qr.jpg') -Algorithm SHA256).Hash.ToLowerInvariant()) { throw 'Donation QR changed in APK.' }
  if ($build.badging -notmatch "package: name='sa.mosque.display'" -or $build.badging -notmatch 'leanback-launchable-activity:') { throw 'TV launcher or package missing.' }
  if (-not $build.badging.Contains("versionCode='$versionCode'") -or -not $build.badging.Contains("versionName='$versionName'") -or $build.manifestTree -notmatch 'android.intent.category.HOME' -or $build.manifestTree -notmatch 'android.intent.category.DEFAULT') { throw 'Updated HOME candidate filter/version missing.' }
  $permissions = @([regex]::Matches($build.badging,"uses-permission: name='([^']+)'") | ForEach-Object {$_.Groups[1].Value})
  $expectedPermissions = @('android.permission.INTERNET','android.permission.ACCESS_NETWORK_STATE','android.permission.REQUEST_INSTALL_PACKAGES')
  if (@(Compare-Object $expectedPermissions $permissions).Count -ne 0) { throw 'Unexpected app permission set.' }
  $updateConfig = [System.Text.Encoding]::UTF8.GetString((Read-ApkBytes 'assets/update-config.json')) | ConvertFrom-Json
  if ($updateConfig.owner -ne 'adel2184' -or $updateConfig.repository -ne 'mosque-tv' -or $updateConfig.metadataAsset -ne 'update.json') { throw 'Wrong update repository.' }
  if ($build.signatureVerification -notmatch 'Verified using v2 scheme.*true' -or $build.signatureVerification -notmatch 'Verified using v3 scheme.*true') { throw 'Signature verification did not pass.' }
  if ($build.signatureVerification -notmatch 'Signer #1 certificate SHA-256 digest: 4cb9564d63fd3f037d12e2ed98af1bf7255a7fb7ef53d6a57aba020b5e9b061e') { throw 'Signing identity changed; upgrade would not preserve installed app.' }
  $result = [ordered]@{
    verifiedAt = [DateTime]::UtcNow.ToString('o'); apkSHA256 = $apkHash; apkBytes = (Get-Item -LiteralPath $apkPath).Length
    entryCount = $names.Count; minSdk = $build.minSdk; targetSdk = $build.targetSdk; versionName = $versionName; versionCode = $versionCode; tvLauncher = $true; homeCandidate = $true
    requestedPermissions = $permissions; updateRepository = 'adel2184/mosque-tv'; signatureV2 = $true; signatureV3 = $true; originalSigningIdentity = $true; coreScriptUnchanged = $true; tvBridgeMatchesSource = $true
    packagedScriptHashes = $expectedSources.Count - 1; phonePageMatchesSource = $true; postPrayerCards = $packagedGuide.postPrayer.Count
    embeddedJsonBlocks = $jsonCount; prayerRecords = 732; adhkar = $enabled.Count; originalQrSHA256 = $qrHash
    locationCatalogSHA256 = $catalogHash; setupCalendarStart = $setupCalendar.rangeStart; setupCalendarEnd = $setupCalendar.rangeEnd; setupCalendarMonthStarts = $setupCalendar.months.Count
    communityProfiles = $deviceProfiles.profiles.Count; communityProfilesSHA256 = $deviceProfilesHash; localReportAssetsMatch = $true; reportReceiver = 'https://mosque-tv-reports-adel2184.netlify.app/api/reports'
    licensesIncluded = $true; privateSigningFilesIncluded = $false
    deviceTests = 'NOT PERFORMED BY THIS SCRIPT: this audit checks package contents and build verification only. See TEST_REPORT_TV.md for version-specific physical-device results.'
  }
  $result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'dist/package-audit.json') -Encoding utf8
  $result | ConvertTo-Json -Depth 6
} finally { $archive.Dispose() }
