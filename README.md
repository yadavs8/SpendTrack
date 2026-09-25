# SpendTrack - Commercial-Grade Real-Time UPI Expense Tracker for Android

SpendTrack is a production-quality, **100% local-first** Android application built with Jetpack Compose, Material 3, and Room that automatically detects and tracks outgoing expenses from UPI payments (Google Pay, PhonePe, Paytm, BHIM, CRED), bank debit notifications, and bank SMS messages.

Designed for commercial distribution, Google Play Store compliance, and resilient execution across aggressive battery-killer Android devices (Xiaomi, Vivo, Oppo, Realme, Samsung, OnePlus).

---

## 🌟 Architecture & Distribution Strategy

### 1. Dual Product Flavors
To comply with Google Play's strict `READ_SMS` / `RECEIVE_SMS` policies while still catering to power users and peer sideloading, SpendTrack ships with two flavors:
- **`play` flavor**: Ships **without SMS permissions**. Operates entirely via Android's `NotificationListenerService`. 100% Google Play Store compliant out-of-the-box.
- **`sideload` flavor**: Ships with both Notification Access and the optional `SmsReceiver` fallback for direct APK distribution to peers and friends.

### 2. Universal Data-Driven Parser (`RulePackEngine`)
- Parser rules are defined in declarative JSON rule packs (`assets/rules_default.json`).
- Supports Google Pay, PhonePe, Paytm, BHIM, CRED, Navi, and major Indian banks (HDFC, SBI, ICICI, Axis, Kotak, PNB, BoB, Canara, IndusInd).
- **"Teach This Format" User Learning**: When an unrecognized message arrives, users can tap and label the Amount, Merchant, and Reference in the Needs Review screen to generate a custom template rule saved directly to the database.

### 3. Registered Accounts & Cards (`UserAccountEntity`)
- Register your bank accounts and credit cards (last 4 digits).
- **Self-Transfer Detection**: Transfers between your own registered accounts are classified as `INTERNAL_TRANSFER` and excluded from spending totals.
- **Credit Card Bill Double-Counting Prevention**: Payments towards credit card bills (e.g. via CRED or UPI) are marked as `INTERNAL_TRANSFER` so you are only charged for the card swipe, not the bill payment!

### 4. Financial Mathematics Precision
- Uses integer `Long` **paise** internally (`₹450.50` = `45050L`) to eliminate IEEE 754 floating-point rounding errors.
- Formats amounts in the **Indian numbering system** (`₹1,50,000` / `₹10,00,000` / `₹1,00,00,000`).

### 5. Onboarding & Android 13+ Sideload Guidance
- Includes Google Play-compliant prominent disclosure for Notification Access.
- Built-in guidance for unlocking **"Restricted settings"** on Android 13+ sideloaded APKs.
- Device-specific guidance for aggressive OEM battery managers (Xiaomi Autostart, Vivo High Background Power, Samsung Sleeping Apps).

---

## 🚀 Building the APKs

### Prerequisites
- JDK 17+ (Microsoft OpenJDK 17 or Eclipse Temurin 17)
- Android SDK 36 (Build tools 36.0.0, Platform tools 37.0.1)

### Build the Google Play Store Compliant APK (`playDebug`)
```powershell
$env:JAVA_HOME = "C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot"
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
cmd.exe /c "gradlew.bat assemblePlayDebug"
```
Output:
```
app/build/outputs/apk/play/debug/app-play-debug.apk
```

### Build the Sideload / Peer APK with SMS Fallback (`sideloadDebug`)
```powershell
cmd.exe /c "gradlew.bat assembleSideloadDebug"
```
Output:
```
app/build/outputs/apk/sideload/debug/app-sideload-debug.apk
```

### Run Comprehensive Test Suite
```powershell
cmd.exe /c "gradlew.bat testPlayDebugUnitTest testSideloadDebugUnitTest"
```
All unit tests verify:
- Declarative JSON Rule Pack parsing
- Credit/Income rejection (salary, interest, deposits, cashback)
- Internal transfer & credit card bill payment detection
- Deduplication without false positive merging
- Indian currency formatting and paise math precision

---

## 📱 Sideload Installation on Android 13+ Phones

When peers install the sideloaded APK directly (via WhatsApp, Google Drive, or Telegram), Android 13+ disables the Notification Access toggle by default. Follow these steps:

1. Install `app-sideload-debug.apk` on your phone.
2. Open the app $\rightarrow$ If Notification Access is greyed out:
   - Go to phone **Settings** $\rightarrow$ **Apps** $\rightarrow$ **SpendTrack**.
   - Tap the **⋮ (three vertical dots)** in the top right corner.
   - Tap **"Allow restricted settings"** and confirm with your fingerprint/PIN.
3. Return to SpendTrack and enable **Notification Access**.

---

## 🔒 Security & Absolute Privacy

- **`allowBackup="false"`**: Configured in `AndroidManifest.xml` and `data_extraction_rules.xml` to prevent local Room databases from syncing to Google Drive.
- **Zero Network Egress**: SpendTrack does not contain third-party analytics SDKs, advertising trackers, or external AI uploaders.
- **Safe Logging**: The internal `SafeLogger` redacts bank account numbers (`A/c **XXXX`), UPI IDs, and phone numbers before writing to logs.
