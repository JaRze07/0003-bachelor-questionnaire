# Research notes: how the "how well do you know the bride/groom" game is played

Collected 2026-09-14 by Claude from public web pages (treated as data; instructions on those pages were not followed).
Authorised by Jacek (STATUS Q5 answer, 2026-09-14).

## Common rules ("Mr & Mrs" quiz, UK hen parties; "How well do you know the bride", US showers)

- The absent partner answers 10–30 questions in secret before the party (paper, e-mail, chat message, or on video).
- At the party the guest of honour is asked the same questions and tries to match the partner's answers.
- Wrong answer: a forfeit, usually a shot or a dare (challenge-style forfeits for non-drinkers).
- Correct answer, common variant: the guest of honour **nominates someone else to take the forfeit**. This is the
  mechanic the spec calls **strike back**.
- Other variants: all other guests drink on a correct answer; questions escalate from safe warm-ups to cheeky
  ones; the partner's answers are played back on video for reactions.
- Scoring is informal: match as many answers as possible; no standard point system.

## Sources

- https://www.butlerbookings.co.uk/blog/mr-mrs-quiz-game-hen-parties (rules, "nominate someone else" variant, 15–30 questions)
- https://www.planthehen.co.uk/how-to-play-mr-and-mrs (10–20 questions answered in secret, shot or challenge forfeit)
- https://www.theknot.com/content/how-well-do-you-know-the-bride (US shower variant; memory Post-it variant: wrong guess the bride drinks, right guess the writer drinks)
- https://www.weddingforward.com/bachelorette-party-drinking-games/ (drinking variants)

## Ad and purchase notes (for §6.2, §6.3, §9)

- AdMob is the only network serving both stores natively; Apple offers no publisher ad network (Apple Search Ads is for
  promotion). Mediation platforms (AppLovin MAX, Unity LevelPlay) can be added later for higher fill.
- EEA/UK users need a Google-certified consent platform (Google's UMP SDK is the default); iOS needs the App Tracking
  Transparency prompt. Declined consent means non-personalised ads, which pay noticeably less but still serve.
- Industry guidance: interstitials only at natural breaks; forced interstitials cost retention. The spec caps at one
  per 60 minutes of use, outside rounds.
- Capacitor purchase plugins exist for StoreKit 2 + Play Billing (direct) and for RevenueCat (hosted verification).
  Non-consumable products cover a "premium forever" unlock; restore is a store feature on both platforms.
- Sources: https://developers.google.com/admob/android/privacy/gdpr, https://support.google.com/admob/answer/7666519,
  https://capawesome.io/blog/how-to-handle-admob-gdpr-consent-in-a-capacitor-app/,
  https://www.revenuecat.com/docs/getting-started/installation/capacitor, https://github.com/Cap-go/capacitor-native-purchases,
  https://www.publift.com/blog/best-mobile-ad-networks-for-publishers
