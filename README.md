# Money Tracker (MVP)

Pay with GPay, PhonePe, Paytm, CRED and the rest, and track everything in one place.
Every UPI payment makes your **bank** send an SMS. The app reads those SMS on your phone and turns each
transaction into a swipe card.

- **Swipe right → Need** (necessary spend)
- **Swipe left → Want** (could have skipped it)
- **Swipe up → Don't count** (transfers between your own accounts, refunds you don't want counted)
- Money-in cards: swipe left or right to confirm, or up to skip.

The top panel shows this month's **inflow, outflow, net**, and your Need vs Want split.

Android only: iOS doesn't let apps read SMS. Everything stays on the phone (SQLite). Nothing is uploaded.

## How it works

| Piece | File |
|---|---|
| Native SMS inbox reader (Kotlin, Expo module) | `modules/sms-reader/` |
| Bank SMS → transaction parser | `src/lib/parser.ts` |
| Local database (expo-sqlite) | `src/lib/db.ts` |
| Reads new SMS each time the app opens | `src/lib/sync.ts` |
| Swipe cards (Gesture Handler v3 + Reanimated) | `src/components/SwipeDeck.tsx` |
| Main screen | `App.tsx` |

The first launch reads the last 60 days of SMS. After that, it reads only messages newer than the last one it saw.
If two SMS share a UPI reference number, only the first is kept.

## Run it

```bash
npm install
npm run test:parser          # check the parser against sample bank SMS
npx expo run:android         # dev build on a USB-connected phone (USB debugging on)
```

Standalone APK (no laptop needed after install):

```bash
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
# → android/app/build/outputs/apk/release/app-release.apk
```

The release APK is signed with the debug key. That's fine for your own phone, but not for the Play Store.
For Play Store you also need Google's approval for READ_SMS, which they only grant to certain app types.

## Improving the parser

If a bank SMS is missed or read wrong, add it to `src/lib/samples.ts` with the expected result, run
`npm run test:parser`, and adjust `src/lib/parser.ts` until it passes.

## Next ideas (after MVP)

- Live capture with an SMS broadcast receiver, so cards are ready before you open the app
- Categories (food, travel, bills), with auto-suggestions per merchant
- Month picker and charts, plus budget alerts on "Want" spend
- Export to CSV / Google Sheets
