# Do You Know Hasina? → Bachelor Questionnaire

## Pending

- Research how the "how well do you know the bride/groom" drinking game is normally played, especially strike-back / counter rules, before writing the spec
- Write the product spec for the free vs premium split with spec-kit (`/speckit-constitution`, `/speckit-specify`) — see Specification below
- Set up a proper Cloudflare connection (wrangler login) and redeploy the Worker from wrangler.toml
- Fix the Worker `REPO_NAME` var (still `Areeb.bachelor`, works only via GitHub redirect)
- Add spec-kit scaffold (`tools\new-project.ps1 -Id 0003-bachelor-questionnaire -ExistingOnly`)

## Specification

Today: a static, host-run bachelor party game ("Do You Know Hasina?") on GitHub Pages with an optional
Cloudflare Worker that saves results to the repo. Full description and setup: `README.md` in this repo.

### Product direction (Jacek, 2026-09-13)

Turn the one-off party page into a general **Bachelor Questionnaire** app with a free tier and a cheap premium tier.

**Free version** (with light, non-annoying ads — this is the rule for all JR77 apps):
- 20–30 ready-made, fairly generic questions.
- Two links. The **partner link** shows only the questions; the partner types their answers and sees nothing else.
- The **host link** is the main app: see questions and answers, reveal the next question on a basic screen,
  answer hidden by default with hide/unhide, mark correct or wrong.
- Default penalty is **drink or dare**; the host describes the drink (what, how much) or the dare.

**Premium version** (very cheap, about €1):
- Create and customise your own questions, unlimited.
- Customise the penalty: drink only, dare only, or something else; define the options.
- Send the finished form to the partner once the questions are done.
- Extra rules such as **strike back**: on a correct answer the player can bounce the dare or drink to someone else.
  Research the usual rules first and adjust.

### Jacek's original notes (verbatim, from the Google Doc tab, 2026-09-13)

> For the bachelor questioner I'm thinking of a free version with some ads, not too annoying ads of course, and that's the case for all the projects. I make the overall MD as well so it never has too annoying ads. The free version would have a basic questioner with ready questions. Let's say 20, 30 ready questions, and then the partner gets the link and they answer the questions. The partner cannot see anything but the questions and they have to type in the answers. The next questions would be pretty generic or whatever and that's what the partner answers. They have the link to get just the answers. The main link or the main part of the app is, of course, where you can see the questions, you can see the answers, and you can take the basic screen to just reveal the next question. By default it's drink or there and you can describe what the drink is, how much they have to drink, or what the there is. You get the questions and by default the answer is hidden but you can unhide it and hide it back and, of course, mark correctly whether it's correct or wrong. I would say in the basic version, the free one, it's 20 questions. In the premium version, which should be very cheap, I would say €1, we have a few more features:
> You can create and customize your own questions and add as many as you want.
> You can customize whether it's drink or there or something else. You can customize what the options are or set that it's only there or only drinks.
> You can, of course, customize the questions and then send the form, once the questions are done, to the partner.
> I'm just thinking maybe research a bit about this game in general, how it's played. I'm thinking that we could make it so that, I guess, in some cases if he answers correctly or if she answers correctly, then they can strike back, right, or counter this there or drink to someone else. Check how it is done normally and then we can adjust the rules for that but that is included only in the premium version. Something like that.
