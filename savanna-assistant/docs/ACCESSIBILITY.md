# Accessibility conformance report: Savanna Assistant

**Target:** WCAG 2.2 Level AA
**Last updated:** ____

## Scope
Web component (`/widget/savanna-assistant.v1.js`), demo page (`/demo`), support console (`/agent`), SMS simulator (`/sms-demo`).
Telegram and SMS are text-only and rely on the user's own messaging app. Messages are short and plain, in English and Amharic.

## Results

| Check | Status | Notes |
|---|---|---|
| Automated axe-core scan (WCAG 2.0/2.1/2.2 A and AA tags) | Pass | Light, dark and 320px views on all three pages, plus widget states (accommodation prompt, Amharic). One dark-mode link contrast issue on `/demo` was found and fixed. |
| Reflow at 320px (no sideways scroll) | Pass (automated) | Checked by script on all pages. |
| Keyboard-only operation | Pending | |
| Screen reader: NVDA | Pending | |
| Screen reader: TalkBack | Pending | |
| Zoom to 400% | Pending | |
| Text spacing (WCAG 1.4.12) | Pending | |
| Windows High Contrast | Pending | |
| Error handling and messages | Pending | |

## Method
Automated: axe-core via Playwright (`npm run a11y`) in light, dark and 320px views.
Manual checks listed above are being completed; results are filled in as each is done.

## Design decisions
- Native `button`, `label` and `textarea` elements. No custom widgets.
- Conversation is a `role="log"` live region. Short status messages use a separate `role="status"`.
- `lang` is set on each message, so Amharic and English get the right voice.
- Buttons are at least 44px tall. Focus ring is 3px and visible in both themes.
- Screen sharing is started by the learner and ends with the browser's own control.
- Interview accommodations never require a diagnosis.

## Known issues and limitations
- Manual testing incomplete (see table).
- Amharic speech depends on the device having an Amharic voice. A text notice is shown when it is missing.