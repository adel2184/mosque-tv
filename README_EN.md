<div align="center">

# Mosque TV · شاشة الجامع

**Prayer times, iqama countdowns, and adhkar for your mosque display.**

مواقيت الصلاة والإقامة والأذكار على شاشة جامعك.

[**العربية**](README.md) · [**English**](README_EN.md)

<p><strong>Download on your TV with Downloader App</strong><br><strong>Download code: <code>1062755</code></strong></p>

<p>Open <strong>Downloader App</strong> on your TV, enter <code>1062755</code>, and select <strong>Go</strong>.<br>After downloading the APK, select <strong>Install</strong>, allow installation from Downloader if Android asks, then open <strong>شاشة الجامع / Mosque TV</strong>.</p>

[![Latest release](https://img.shields.io/github/v/release/adel2184/mosque-tv?label=Release&color=176b50)](https://github.com/adel2184/mosque-tv/releases/latest)
![Android 7 or later](https://img.shields.io/badge/Android-7%2B-176b50)
![Interface languages](https://img.shields.io/badge/UI-Arabic%20%7C%20English-176b50)

**[Download APK](https://github.com/adel2184/mosque-tv/releases/latest/download/mosque-display-tv.apk) · [Installation](#install) · [All releases](https://github.com/adel2184/mosque-tv/releases)**

![English preview of Mosque TV showing the clock, date, prayer timetable, countdown, and Arabic adhkar](docs/images/display-en.webp)

</div>

Mosque TV turns a compatible **Android TV or Google TV** into a mosque display with prayer times, adhan and iqama countdowns, Hijri and Gregorian dates, adhkar, and announcements. Use your TV remote to configure it in Arabic or English. Local calculation, initial setup, and everyday display work **without internet** after installation. The app is silent.

[Features](#features) · [Screenshots](#screenshots) · [Install](#install) · [Setup](#setup) · [Updates](#updates) · [FAQ](#faq) · [Guides](#guides)

<a id="features"></a>
## What it offers

| On the display | For the administrator |
| --- | --- |
| Prayer times, followed by adhan and iqama countdowns | Six-step setup in Arabic or English |
| Black prayer screen with “Straighten your rows” in Arabic, then automatic return | Custom iqama and Friday schedules and prayer-mode duration |
| Clock, Hijri date, and Gregorian date | Mosque details, announcements, and extra text fields |
| 18 Arabic adhkar and religious texts | Optional donation card and QR image; hidden on a fresh install |
| Local display with no in-app advertising | JSON settings and timetable import and export |
| Offline catalog of 244 countries and territories and 34,247 cities | Remote-friendly control center and temporary phone pairing on your LAN |

Additional tools include display schedules, TV settings shortcuts, optional device preparation, updates, and problem reports initiated by the administrator. System features depend on your TV and its permissions. See the [TV guide (Arabic)](android/README_TV_AR.md).

<a id="screenshots"></a>
## Screenshots

<table>
<tr>
<td width="50%"><a href="docs/images/display-ar.webp"><img src="docs/images/display-ar.webp" alt="Arabic display with prayer times and adhkar" width="480"></a><br><strong>Arabic display</strong><br>Prayer times, clock, countdown, and religious reminders.</td>
<td width="50%"><a href="docs/images/setup-ar.webp"><img src="docs/images/setup-ar.webp" alt="Arabic setup review showing location, time zone, and calculation preset before preparing a timetable" width="480"></a><br><strong>Review your setup</strong><br>Check location, time zone, and calculation preset before preparation.</td>
</tr>
<tr>
<td><a href="docs/images/control-center-ar.webp"><img src="docs/images/control-center-ar.webp" alt="Arabic TV control center in browser preview mode" width="480"></a><br><strong>Control centre</strong><br>Reach mosque settings and device tools with the remote.</td>
<td><a href="docs/images/prayer-mode.webp"><img src="docs/images/prayer-mode.webp" alt="Arabic straighten-your-rows message against a black prayer screen" width="480"></a><br><strong>Prayer mode</strong><br>A clear message against a black background at iqama.</td>
</tr>
</table>

These are browser previews of the actual 2.3.2 source UI using demonstration data. Android options in the control-center image are simulated for preview; these are not captures from a physical TV. Click any image to enlarge it.

<a id="install"></a>
## Install: choose your path

| Path | Requirements | Start here |
| --- | --- | --- |
| **Android TV / Google TV** | Android 7+, a compatible WebView, and a remote | **Downloader App: `1062755`** or [download APK](https://github.com/adel2184/mosque-tv/releases/latest/download/mosque-display-tv.apk) |
| **Computer or browser preview** | A modern browser and the source; Node.js for the initial build | [Build and run guide](docs/DEVELOPMENT.md), with [detailed browser instructions (Arabic)](README_AR.md) |

### On your TV

**Directly on your TV:** open Downloader App and use code **`1062755`**, then complete installation as described at the top of this page.

**Using a USB drive or file transfer:**

1. Open the [latest release](https://github.com/adel2184/mosque-tv/releases/latest) and download **`mosque-display-tv.apk`**. You do not need source files or developer tools on the TV.
2. Copy the APK to a USB drive and open it on the TV with a file manager that supports APK installation. You can also use a file-transfer method you trust.
3. If Android asks, allow installation from the file manager you are using and complete the system installation dialog.
4. Open **شاشة الجامع / Mosque TV** in the apps list and complete setup below. The USB drive and computer are no longer needed for everyday display.

**Already installed?** Install the update over the existing app, keeping its data. Export a settings backup if possible. If Android rejects the update, check the download source and signing certificate before considering any uninstall.

The APK is for compatible Android devices. Samsung Tizen and LG webOS need other solutions. See [compatibility and FAQ](#faq).

<a id="setup"></a>
## First-time setup

1. **Language:** choose Arabic or English.
2. **Location:** select your country and city from the offline catalog.
3. **Display:** check the time zone and choose clock and date formats.
4. **Calculation:** choose a prayer-time calculation preset for your location.
5. **Mosque details:** enter the mosque name and neighborhood.
6. **Review:** choose **Prepare calculated times** for offline calculation, import a JSON timetable, or optionally download from UmmahAPI while online. Prepare the timetable, then select **Finish and save**.

**Before using it in your mosque:** check the device clock, prayer times, iqama intervals, and Friday schedule with the mosque administration. Times are calculated and need review; a named calculation preset does not make them an official timetable. Setup prepares the current and following year.

The [English setup guide](docs/SETUP_EN.md) covers every step and timetable source. [دليل الإعداد بالعربية](docs/SETUP_AR.md).

### Remote controls

| Button | Action |
| --- | --- |
| Arrow keys | Move between items |
| OK | Select an item or edit a value |
| Back | Go back, cancel editing, or close the panel |
| On-screen gear | Open the control center; hidden during prayer mode |
| MENU, if sent by your remote | Shortcut to the control center |

Open **Control centre → Mosque settings** to adjust details, iqama, and announcements. Choose **Save and apply** to commit the draft. For phone input, open pairing and scan the QR code from a phone on the same trusted local network; the session lasts 15 minutes. [Control-center guide (Arabic)](docs/CONTROL_CENTER_AR.md).

<a id="updates"></a>
## Update while keeping settings

Open **Version and updates → Check for an app update**, download the release, and select **Install**. Complete Android's permission and installation prompts if requested. Updating requires a temporary internet connection; local display continues without internet. You can also install the new APK manually over the existing app.

Updates preserve saved mosque details and timetables and do not force first-time setup again. See the [release notes](https://github.com/adel2184/mosque-tv/releases/latest) for changes and the [verification report (Arabic)](android/TEST_REPORT_TV.md) for tested behavior. The published release when this page was prepared is **2.3.2**; improved remote response on a physical TV has not yet been measured for this release.

<a id="faq"></a>
## Frequently asked questions

**Does it need internet?**<br>
Offline calculation, setup, and everyday display do not. Downloading the app or updates, fetching from UmmahAPI, running a speed test, or sending a problem report requires internet when you choose that action. Phone pairing needs only a shared local network.

**Is the interface fully English?**<br>
English is available for the interface, settings, clock, and prayer names. Adhkar and religious texts remain in Arabic. Text you enter keeps its original language.

**Does it play the adhan?**<br>
The app is silent. Prayer times, countdowns, and prayer mode are visual.

**Will it work on every smart TV?**<br>
It needs compatible Android TV or Google TV with Android 7+ and a suitable WebView. Some TCL behavior is documented; this is not verification of every model. Starting after a reboot or power failure depends on the TV and its configuration. [TCL results (Arabic)](docs/TCL_TEST_RESULTS_AR.md).

**Does the display timer turn off the TV?**<br>
It shows black inside the app; it does not power off the physical panel. Native power behavior depends on the device.

**What if the times or date are wrong?**<br>
Check the device clock, city, time zone, and calculation preset. Review the timetable with mosque staff. To run setup again, open Mosque settings → Timetable and calendar → Set up location, language and calendar. Export a backup before changing an existing configuration.

**Are mosque details sent automatically?**<br>
The display and its data are local. Problem reports are optional and require a local preview, review, consent, and final confirmation. Review the text even after automatic redaction. [Reporting-service details (Arabic)](services/reports/README.md).

<a id="guides"></a>
## Guides and contributions

| Guide | What it covers |
| --- | --- |
| [English setup](docs/SETUP_EN.md) · [الإعداد بالعربية](docs/SETUP_AR.md) | First launch and timetable sources |
| [Development](docs/DEVELOPMENT.md) · [Contributing](CONTRIBUTING.md) | Build, verify, and contribute |
| [TV guide](android/README_TV_AR.md) · [Browser guide](README_AR.md) — Arabic | Operation, customization, and backups |
| [Control centre](docs/CONTROL_CENTER_AR.md) · [Device preparation](docs/DEVICE_PREPARATION_AR.md) — Arabic | Remote, phone, power, and advanced tools |
| [Data sources](DATA_SOURCES.md) · [Location and calendar](docs/LOCATION_SOURCES_AR.md) — Arabic | Calculation, references, and component licenses |
| [TV verification](android/TEST_REPORT_TV.md) · [Technical notes](docs/PROJECT_NOTES_AR.md) — Arabic | Results, test limits, and release details |

For a bug or suggestion, open an [issue](https://github.com/adel2184/mosque-tv/issues) in English or Arabic. Include the version, TV model, and reproduction steps after removing private information. Optional in-app reporting is also available.

Component, data, and font licenses are preserved in [licenses](licenses/), [assets/fonts](assets/fonts/), and [Android attribution](android/SOURCES_LICENSES.md). The project code currently has no separate overall license; component licenses apply to their respective authors' work.

---

May Allah accept this work as an ongoing charity (sadaqah jariyah) on behalf of me, my family, and my parents, and make it beneficial to others.

<p dir="rtl">اللهم اجعل هذا العمل صدقةً جاريةً عني وعن أهلي ووالديَّ، وانفع به، وتقبّله منا.</p>
