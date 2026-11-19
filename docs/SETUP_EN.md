# First-time setup

[English overview](../README_EN.md) · [العربية](SETUP_AR.md)

Local setup, prayer-time calculation, the calendar, and everyday display work offline. A fresh install shows the wizard; updating an existing installation keeps its saved details, campaign, and timetable without forcing setup again.

To run it again later, open **Control centre → Mosque settings → Timetable and calendar → Set up location, language and calendar**. Export a settings backup before replacing an existing configuration.

## Before you begin

Install [mosque-display-tv.apk](https://github.com/adel2184/mosque-tv/releases/latest/download/mosque-display-tv.apk) on a compatible Android TV / Google TV with Android 7+ and a suitable WebView. Check that the TV clock is correct. Use arrow keys to move and **OK** to select. On a text or search field, OK opens the TV keyboard when supported. **Back** returns to the previous step; on the first page of a fresh installation, you must complete setup to proceed to the display.

## The six steps

| Step | What to do |
| --- | --- |
| **1. Language** | Choose Arabic or English. Interface controls, settings, the clock, and prayer names follow your choice. The 18 adhkar and religious texts remain Arabic; your own text keeps its original language. |
| **2. Country and city** | Search and select from the bundled catalog of 244 countries and territories and 34,247 cities. Not every village or neighborhood is included. Arabic names are available for 1,038 cities; other entries use the available original or Latin name. |
| **3. Display** | Check the IANA time zone. Choose a 12- or 24-hour clock and Hijri, Gregorian, or both dates. Device clock accuracy matters; daylight-saving rules depend on the device's time-zone data. |
| **4. Calculation preset** | Choose Umm al-Qura, Muslim World League, Egyptian, North America, or Karachi. These are calculation-library presets, not official download services or endorsements. Review the results for your mosque. |
| **5. Mosque details** | Enter the name and neighborhood. The neighborhood is a text description; calculations use the selected city's coordinates. |
| **6. Review and prepare** | Check the location, time zone, preset, and name. Explicitly choose a timetable source below. After successful preparation, review its source and coverage, then select **Finish and save**. |

## Choose a timetable source

### Prepare calculated times (offline)

Uses the bundled Adhan engine and local Umm al-Qura calendar to prepare the current and following year, including a boundary day before and after. No internet is required. The timetable is marked as calculated and needing review.

If the engine cannot resolve a location's prayer times, including some polar conditions, or finds invalid or overlapping events, preparation fails. Use a valid, reviewed timetable for that location rather than assuming substitute times.

### Import local JSON

Select a timetable that matches the schema, location, calculation preset, and required coverage. Validation checks structure and consistency; it does not establish official provenance or mosque approval. Keep the actual source, license, and review status with the data. See the [data sources (Arabic)](../DATA_SOURCES.md) and the tracked [timetable example](../data/timetable.json).

### Download from UmmahAPI

This optional path requires internet and starts only when selected. It requests 24 months across the two years plus the two boundary days: 26 responses in total. You can cancel while downloading. Responses are validated before use; the result is still calculated third-party data requiring review. A successful daily or monthly request does not establish that a full two-year download will succeed.

## Save and check the result

**Finish and save** validates and stores the profile, settings, and timetable together. Moving between steps or preparing a timetable does not overwrite the old configuration. If saving fails, the previous saved record remains available. During preparation, Back or Cancel stops the operation and leaves you on the review page.

Before leaving the display in use:

- Compare prayer times with the mosque's approved schedule. Check the city, time zone, calculation preset, and device clock if they differ.
- Set and review iqama intervals with mosque staff. Add your actual Friday schedule; there is no assumed Friday prayer time.
- Confirm the mosque details and announcements, then choose **Save and apply** for settings drafts.
- Export a settings backup. Timetable export is a separate action; keep a copy of it if using a custom table.

The donation card starts hidden on a fresh install. Configure it and explicitly enable it if needed. Updating preserves an existing campaign and its visibility.

## Useful distinctions

- The bundled civil Umm al-Qura calendar covers **1924-08-01 to 2077-11-16**. This is calendar coverage; setup prepares prayer times only for the current and following year. Hijri date changes at midnight in the selected time zone.
- The app is silent. At iqama it shows a black prayer screen with **أقيموا صفوفكم** (“Straighten your rows”), then returns automatically after the configured duration.
- Display schedules and the display timer show black inside the app; they do not switch off the TV panel. Auto-start after reboot or power loss depends on the TV.
- On staff-only Wi-Fi, scan the TV’s pairing QR, compare the code on both screens and approve it with the TV remote. One phone is authorized for up to 15 minutes. The local HTTP link is unencrypted. Use the physical remote on guest Wi-Fi and for sensitive text.
- Daily display remains local. Internet is needed only for online actions such as updates, UmmahAPI downloads, speed tests, or confirmed problem reports.

Detailed advanced guides and hardware test reports are currently in Arabic: [TV operation](../android/README_TV_AR.md), [control center](CONTROL_CENTER_AR.md), [location and calendar](LOCATION_SOURCES_AR.md), and [verification report](../android/TEST_REPORT_TV.md).
