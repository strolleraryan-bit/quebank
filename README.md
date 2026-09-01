# Quebank by Aryan

A PWA question bank for UPSC / UPPCS prep. Two modes:

- **Objective** — enter a topic, get 30 fresh MCQs (UPSC/UPPCS Prelims style, PYQs included), take them as a real test, get a report card at the end. Questions are generated in **batches of 5** rather than all 30 at once (free-tier Gemini is slow/unreliable with a single 30-question call) — the first 5 land immediately so you can start right away, and the next 5 are fetched automatically the moment you click "Next" past the last one currently loaded; the palette shows dashed placeholder dots for batches not generated yet, and "Submit test" stays disabled until all 30 are in. Each later batch tells Gemini which questions already exist for that topic so it doesn't repeat one, with a client-side safety check on top in case it does anyway. A **Mix test** pulls 50 random questions from every topic you've generated so far. Each question can be **flagged** for review (flag state is saved per question and follows it into mix tests too); a finished test can be **retaken** with the exact same question set from the report card, which also shows a **score history trend** (previous attempts on that topic) and lets you **toggle each question's explanation** open or filter the review list to flagged questions only.
- **Subjective** — enter a topic, get 5 Mains-style questions (PYQs included). For each question, pick a word limit (125 / 150 / 200 / 250) and Quebank writes a topper-style model answer at that length — structured like a real UPSC Mains answer (introduction, dimension-wise body, conclusion), with examples, case studies, or an analytical approach worked in wherever the topic genuinely calls for one. Answers are fetched per word limit only when you tap that length, and cached per length once fetched. Once an answer is showing, you can **select any part of it to highlight it and attach a note** — highlights and notes are saved per topic/question/word-limit and listed under the answer for quick review.

Every topic you generate (both modes) is saved to the hamburger menu, where you can **tag it GS1–GS6** (via the 🏷 button on each entry) and later **filter by tag** or **search saved topics by name**. The home screen always opens blank, ready for a new topic — history lives only in the menu.

Question generation runs through a Netlify serverless function so the Gemini API key never reaches the browser.

**Language** — a two-button switch in the top bar (`EN` / `हिं`) changes the entire interface — every label, button, hint, and placeholder — instantly, one click each way. It also tells the generator which language to *write* new content in, so any topic you generate while a language is selected comes back in that language (questions, options, explanations, model answers — all of it). The selection is remembered (`localStorage`) for next time.

Saved topics follow the switch too, just lazily: a topic generated in one language keeps that language until the next time it's actually opened (test started, subjective set viewed, or pulled into a mix test) under a different UI language — at that point it's translated with one Gemini call (questions, options, explanations, and any already-fetched model answers, all in one request), and both language versions are then cached on the saved topic so toggling back and forth afterwards is instant and doesn't call Gemini again. If a topic or subjective set is already open on-screen when you flip the switch, it translates immediately in place rather than waiting for you to reopen it. Fetching a new model-answer word length afterwards invalidates that topic's translation cache (so a stale/incomplete translation is never shown) and gets rebuilt on the next language switch. Highlights/notes on a model answer are saved as character positions in that specific answer's text, so a freshly-translated copy of an answer starts with no highlights (the original-language copy keeps its own highlights untouched); flags, tags, and score history are plain data and aren't affected by translation at all.

---

## 1. Files in this project

```
index.html                     App shell, all screen templates
style.css                      Styling (exam-paper visual identity)
app.js                         All client logic: state, test engine, storage, API calls
manifest.json                  PWA manifest
sw.js                          Service worker (offline app-shell caching)
icons/icon.svg                 App icon
netlify.toml                   Netlify build/functions config
netlify/functions/generate.js  Server-side Gemini proxy (holds the API key)
README.md                      This file
```

No build step, no npm dependencies for the frontend. The Netlify function uses Node's built-in `fetch`, so no `package.json` is required either.

`demo.html` is **not** part of this list and not part of the zip — see the next section.

---

## 1a. Try it without deploying (standalone demo.html)

A separate, standalone `demo.html` is delivered alongside the zip, not inside it. It's a single self-contained file — the app's CSS and JS plus a small mock question generator are all inlined into that one file, so it has zero dependencies on any other file in this project. Just double-click it, or drag it into a browser tab — no Netlify, no API key, no server, and nothing else needs to be unzipped alongside it.

- The mock generator intercepts question generation the same way the real app's `callGenerate` normally calls Gemini, and pre-seeds two sample objective topics + one subjective topic into `localStorage` so the hamburger menu and mix test aren't empty on first look. The seed data also includes a couple of flagged questions, three past attempts (so the score-trend chart has something to show), GS-tags on each topic, and one pre-saved highlight+note on a cached model answer — so every new feature is visible without generating anything first.
- Typing any topic into the Objective or Subjective form still "generates" a full set (30 MCQs / 5 Mains questions) — built from a small local template instead of Gemini, so the full test-taking flow, report card, and word-limit model answers all work exactly like production (sample answers are clearly labeled, e.g. "[Sample model answer — demo mode, target ~150 words]", so they're never mistaken for a real Gemini response).
- The language switch (`EN` / `हिं`) works too — the mock generator returns pre-written English or Hindi sample content depending on which is selected when you generate, same as production would via Gemini. Opening one of the pre-seeded sample topics under the other language also works, via a mock `translate` response labeled `(demo translation)` so it's never mistaken for a real Gemini translation.
- Flagging questions, retaking a test, toggling explanations, filtering the review list to flagged-only, searching/tagging saved topics, and highlighting/annotating a model answer all work identically to production — none of it touches Gemini, so none of it is mocked beyond the question/answer content itself.
- It never calls the network and never needs `GEMINI_API_KEY`.

---

## 2. Get a Gemini API key

1. Go to [Google AI Studio](https://aistudio.google.com/apikey).
2. Sign in, click **Create API key**.
3. Copy the key — you'll paste it into Netlify in the next step, not into any file in this project.

---

## 3. Deploy to Netlify

### Option A — drag and drop (fastest)
1. Go to [app.netlify.com](https://app.netlify.com) → **Add new site → Deploy manually**.
2. Drag the whole project folder (unzipped) onto the upload area.
3. Once deployed: **Site configuration → Environment variables → Add a variable**
   - Key: `GEMINI_API_KEY`
   - Value: *(paste your key)*
4. **Deploys → Trigger deploy** (env vars only take effect on a fresh deploy).

### Option B — Netlify CLI (recommended if you'll keep updating this)
```bash
npm install -g netlify-cli
cd quebank
netlify init          # or: netlify link, if the site already exists
netlify env:set GEMINI_API_KEY "your-key-here"
netlify deploy --prod
```

### Option C — Git-connected (auto-deploys on push)
1. Push this folder to a GitHub repo.
2. Netlify → **Add new site → Import an existing project** → pick the repo.
3. Build command: *(leave blank)* — Publish directory: `.`
4. Add the `GEMINI_API_KEY` environment variable as in Option A, step 3.

---

## 4. Local development

```bash
npm install -g netlify-cli      # once
cd quebank
netlify dev
```
This serves `index.html` and runs `netlify/functions/generate.js` locally so you can test end-to-end. Set the key locally first:
```bash
netlify env:set GEMINI_API_KEY "your-key-here"
```

---

## 5. Data & storage notes

- All topics, questions, test answers, and results are stored in the browser's `localStorage` — nothing is stored on a server or shared between devices.
- Per-topic extras — flags, tags, score history, and (for subjective topics) highlights/notes on model answers — live on the same saved-topic objects, so they're included in Export/Restore automatically and wiped along with everything else if you clear site data.
- Objective topics keep up to the last 20 attempts in their score history (`entry.history`); older attempts roll off so storage doesn't grow without bound. `entry.lastResult` still holds just the most recent attempt, unchanged.
- Question flags are stored on the objective topic that owns the question (`entry.flags`, keyed by question id), not on the test session — so a flag set during a mix test still shows up if you later open that question's own topic, and vice versa.
- An objective topic's target size lives in `entry.totalPlanned` (always 30 for topics generated by this version). While `entry.questions.length < entry.totalPlanned`, the topic is "partial" — its test screen shows placeholder dots for the ungenerated slots and fetches the next batch of 5 automatically when you step past the last loaded question; "Submit test" is disabled until it's fully loaded. Reopening a partial topic later (from the menu, or via a restored backup) resumes batching from wherever it left off rather than re-fetching from scratch. A backup file from before this feature existed has no `totalPlanned` field — on import it's treated as already-complete (`totalPlanned` defaults to however many questions the file actually contains), so old backups never get stuck expecting more questions than they have.
- Highlights/notes on a subjective model answer are stored as character offsets into that specific answer's text (`question.annotations[wordLimit]`), scoped per topic/question/word-limit.
- The selected interface language (`en` / `hi`) is also stored in `localStorage` and persists across visits.
- Clearing browser site data wipes all saved topics, history, and the language preference.
- The Netlify function is stateless — it only forwards a prompt to Gemini and returns parsed JSON; it does not store anything.
- The model called is `gemini-flash-latest` (an alias Google keeps pointed at their current default Flash model, so this project doesn't silently break on the next model deprecation). To pin a specific version instead, edit the `MODEL` constant at the top of `netlify/functions/generate.js`.

---

## 5a. Reliability — how generation failures are handled

Every generation (Objective 30-MCQ set, Mix test's underlying topics, Subjective 5-question set, per-word-limit model answer, and translation) still runs as **one Gemini call per topic/action** — not batched into smaller chunks — so a fully generated topic keeps working offline afterwards, per the storage model above. Reliability instead comes from making that one call sturdy:

- **`responseSchema` on every Gemini call** (`netlify/functions/generate.js`) — the request constrains Gemini's output to an exact JSON shape at generation time (via `generationConfig.responseSchema`), not just via prompt instructions. This is the main reason malformed/truncated JSON is now rare.
- **Server-side retry with backoff** — each Gemini call gets up to 3 attempts (short backoff between them) on transient failures: network error, timeout, a 5xx from Gemini, or a response that fails structural validation (e.g. an objective set with fewer than 20 well-formed questions). Non-transient failures (bad API key, bad request) are not retried, since retrying can't fix those.
- **429 (rate limit) and 503 (overloaded) get special handling.** Both are treated as retryable, and when Gemini's response includes a `Retry-After` header, the server sleeps that long instead of the generic fixed backoff (capped at `MAX_RESPECTED_RETRY_AFTER_MS`, 4s, so a long quota-reset wait can't stall the function past Netlify's time limit). The real HTTP status is also passed through to the client instead of being flattened to a generic 502, so a 429 is recognizable as a rate limit rather than a vague server error. Note that retrying can only smooth over a brief burst — if you're hitting 429 repeatedly, it usually means your Gemini API key's free-tier requests-per-minute quota is genuinely exhausted (more likely now that objective generation makes several calls per topic via batching, see Section 5d), and the fix is to wait longer between generations or move to a paid Gemini tier with a higher quota, not a code change.
- **Per-attempt timeout** — each attempt is capped (`ATTEMPT_TIMEOUT_MS`, currently 9s) via `AbortController`, so a stuck upstream call fails fast enough to retry instead of hanging until Netlify kills the function. The full retry budget is kept comfortably under Netlify's synchronous function time limit.
- **Partial-credit validation, not all-or-nothing** — an Objective set is accepted once it has at least 20 valid questions (not necessarily all 30); a Subjective set needs at least 3 of 5. This avoids discarding an otherwise-usable generation over one malformed item.
- **Client-side timeout + one silent retry** (`app.js`, `postWithRetry`) — every call to the Netlify function has its own 20s client-side timeout and retries once automatically on a transient failure (429, 502, 503, 504, or a network-level error) before anything is shown to the user. The manual "Retry" button on the error screen remains as a fallback if both the server-side and client-side retries are exhausted.
- **Client-side self-throttling across all modes** (`app.js`, `MIN_CALL_INTERVAL_MS`) — every call to the Netlify function, regardless of action (objective batch, subjective questions, subjective model answer, translate), is spaced at least ~4.5s apart. Gemini's free-tier RPM limit is per project, not per feature, so objective and subjective calls draw from the same shared bucket — without this, alternating between modes could burst past the limit even if each mode individually stayed under it.

If you need to tune this: `MAX_ATTEMPTS`, `ATTEMPT_TIMEOUT_MS`, and `BACKOFF_BASE_MS` are constants at the top of `netlify/functions/generate.js`; `REQUEST_TIMEOUT_MS`, `CLIENT_RETRY_DELAY_MS`, and `MIN_CALL_INTERVAL_MS` are near the top of the API helper section in `app.js`.

---

## 5b. Backup & Restore

The hamburger menu has an **Export backup (.json)** and **Restore from backup** button at the bottom, below the saved-topic lists.

- **Export** downloads a single JSON file (`quebank-backup-YYYY-MM-DD.json`) containing everything the app stores in `localStorage`: both saved-topic lists (`qb_objective_topics`, `qb_subjective_topics`) and the current language preference (`qb_lang`), plus a `format`/`version` tag used to validate the file on import. Nothing leaves the device — this is a client-side download, no server involved.
- **Restore** opens a file picker. The selected file is validated structurally (correct `format` tag, each topic has the fields the app actually expects) before anything is touched — malformed or unrelated JSON is rejected with a clear message, and individual malformed topic entries inside an otherwise-valid file are silently skipped rather than failing the whole import.
- Once a valid backup is loaded, you're asked to choose:
  - **Merge** (default/OK) — adds any topic from the backup whose `id` isn't already saved locally. Nothing existing is deleted or overwritten; topics already present (matched by `id`) are skipped. Your current language preference is left as-is.
  - **Replace** (Cancel) — wipes current saved topics entirely and replaces them with exactly what's in the backup, including switching the interface to the language the backup was exported under.
- A one-line status message (added/skipped counts, or a replace confirmation) appears at the bottom of the menu after either action, and clears the next time the menu is reopened.

This is intentionally a manual, on-device backup — there's no automatic sync or cloud storage, consistent with the "nothing shared between devices" model in Section 5.

---

## 5c. Known-fixed bugs (for reference)

- **Structural-validation failures weren't being retried.** `generate.js`'s retry loop was designed to retry when Gemini returns a response that fails structural validation (e.g. an objective set with fewer than 20 well-formed questions) — but the call site marked that specific failure as non-retryable (`retryable: false`), so it silently skipped retry on exactly the failure mode most likely to occur. Fixed: validation failures now retry like every other transient failure.
- **Backup's language preference was exported but never restored.** A backup file includes `qb_lang`, and the README described it as part of the backup, but nothing on the import path ever read it back — even a full "Replace" restore left the interface language untouched. Fixed: Replace now also restores the language the backup was exported under; Merge intentionally still leaves your current language preference alone, since merge only adds topics rather than replacing state.
- **Two hardcoded English strings bypassed the language switch.** The subjective-answer fetch's empty-response fallback (`'No answer returned — try again.'`) and the exam palette dot's `aria-label` (`` `Question ${i+1}` ``) were plain string literals instead of going through `t()`, so a Hindi-mode user who hit either case still saw English. Fixed: both now route through the i18n dictionary (`subj.noAnswerFallback`, `test.qAriaLabel`), translated in both languages and re-applied on language switch like everything else.
- **Navigating away during a next-batch fetch could snap back and clobber it.** When "Next" triggered `maybeFetchNextObjectiveBatch()` (stepping past the last loaded question), only the Next button was disabled while the fetch was in flight — "Previous" and already-loaded palette dots stayed clickable and changed `testState.current` immediately. Once the pending fetch resolved, the original `moveQuestion()` call resumed and unconditionally set `testState.current` back to its original target, silently overwriting wherever the user had just navigated to. Fixed: a `batchFetchInProgress` flag now locks Previous and the palette dots (in addition to Next) for the duration of a batch fetch, so no navigation can race with it.
- **429/503 from Gemini weren't handled with enough patience.** All non-4xx-bad-request failures were flattened to a generic 502 and retried with a short fixed backoff (~400ms, ~800ms total) — nowhere near long enough for an actual rate-limit or overload response, and Gemini's own `Retry-After` header was ignored entirely. This got more likely to bite after the batching change (Section 5d), since one 30-question objective set now makes several Gemini calls instead of one. Fixed: the server now reads `Retry-After` when Gemini provides it (capped at 4s so it can't stall the function) and passes the real status code (429 vs 502) through to the client instead of masking it; the client's transient-error check was updated to recognize 429 too, so its own one-shot retry still fires for it. Repeated 429s past that point mean the API key's quota is genuinely exhausted — that needs waiting longer or a higher Gemini tier, not a retry-logic change.

---

## 5d. Objective generation batching (design notes)

Free-tier Gemini keys struggle with a single 30-MCQ generation call — it's a large response under `responseSchema` constraints, and free-tier rate limits make retries on a failed 30-question call expensive. Objective sets are generated in batches of `OBJ_BATCH_SIZE` (5, in `app.js`) instead:

- `generateObjectiveTopic()` fetches only the first batch and starts the test immediately with `entry.totalPlanned = OBJ_PER_TOPIC` (30) recorded on the saved entry.
- `maybeFetchNextObjectiveBatch()` runs when the user clicks "Next" past the last currently-loaded question. It sends the server every question's text generated so far for that topic (`excludeQuestions`) so Gemini is told not to repeat one, then does its own defensive text-match de-dupe against the response before appending — belt-and-suspenders, since a schema-constrained call can still occasionally echo something back despite the instruction.
- The Netlify function's `objective` action accepts `count` (1–30, default 30 for backward compatibility) and `excludeQuestions`; its partial-credit validation threshold scales with `count` (≥67%) instead of the old fixed "≥20 of 30".
- The test screen always shows the *planned* total ("Question 3 of 30") even while only 5–10 are actually loaded; the palette renders dashed, unclickable placeholder dots for the rest. "Submit test" is disabled and relabeled with a loading count until every planned question has arrived.
- Retakes and mix tests are unaffected — both only ever run against a topic's full, already-saved `entry.questions` (a retake happens from the report screen, which is only reachable once a topic is fully loaded; a mix test pulls from whatever's currently saved across all topics, complete or not, same as before).
- If the user closes the app mid-generation, the topic is saved as partial (`entry.questions.length < entry.totalPlanned`) and resumes batching from where it left off next time it's opened, rather than restarting from question 1.

---

## 6. Standing maintenance routine — run this on every update

Whenever this project is modified (by Claude or anyone else), before calling the work done:

1. **Diff every file against the previous version** — re-check `index.html`, `style.css`, `app.js`, `manifest.json`, `sw.js`, `netlify.toml`, and `netlify/functions/generate.js` for whether each one was actually touched by the change just made.
2. **Bump `CACHE_NAME` in `sw.js`** if any shell file (`index.html`, `style.css`, `app.js`, `manifest.json`, `icons/icon.svg`) changed — otherwise returning users can get stuck on stale cached files.
3. **Always regenerate the standalone `demo.html`** so the demo never drifts from the real app — inline the current `style.css` and `app.js` plus a mock generator/seed data into one self-contained file, the same way as before. If a feature, screen, or field was added/changed/removed in `index.html` / `app.js`, mirror it in the demo's mock data so the demo doesn't break. Deliver it as a separate file alongside the zip — **never place it inside `quebank.zip`**.
4. **Rebuild the zip so it contains every current file** — no stale versions, no missing new files, and no `demo.html` inside it:
   ```bash
   cd quebank
   zip -r ../quebank.zip . -x "*.DS_Store"
   ```
5. **Update this README** — reflect any new file, changed setup step, changed feature, or changed model name before packaging. Update the file tree in Section 1 if files were added or removed.
6. **Confirm the zip and the README were built in the same pass** — a zip without a matching README, or a README describing files that aren't in the zip, means a step above was skipped. Also open the standalone `demo.html` once and click through both modes to confirm it still runs end-to-end on its own.

A quick verification command to list exactly what's about to ship:
```bash
cd quebank && find . -type f -not -path "./.git/*" | sort
```
Compare that output against Section 1's file tree before zipping.
