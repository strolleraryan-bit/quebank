// Quebank by Aryan — client app logic.
// All Gemini calls go through /.netlify/functions/generate (server-side API key).

const API_ENDPOINT = '/.netlify/functions/generate';
const LS_OBJ = 'qb_objective_topics';
const LS_SUB = 'qb_subjective_topics';
const LS_LANG = 'qb_lang';
const MIX_TARGET = 50;
const OBJ_PER_TOPIC = 30;
const OBJ_BATCH_SIZE = 5; // generate/append this many MCQs at a time (free-tier Gemini struggles with 30 in one call)
const SUB_PER_TOPIC = 5;
const GS_TAGS = ['GS1', 'GS2', 'GS3', 'GS4', 'GS5', 'GS6'];
const SCORE_HISTORY_MAX = 20; // cap per-topic history length so storage doesn't grow unbounded

const app = document.getElementById('app');

// ---------- i18n ----------
// One-click language switch (EN / HI). This translates the app's interface
// chrome instantly and client-side. It also tells the generator (Gemini,
// via the Netlify function) which language to WRITE new content in, so
// topics generated after switching come back in that language too.
// Topics generated before a switch are translated lazily: the first time
// a saved topic is opened (test started / subjective set viewed / pulled
// into a mix test) under a different UI language than it was generated
// in, it's translated with one Gemini call, and both language versions
// are cached on the entry (see ensureObjectiveEntryLang /
// ensureSubjectiveEntryLang below) so toggling back and forth afterwards
// is instant and doesn't re-call Gemini.
const I18N = {
  en: {
    'menu.open': 'Open menu',
    'menu.close': 'Close menu',
    'menu.savedTopics': 'Saved topics',
    'menu.emptyObj': 'No objective topics yet.',
    'menu.emptySub': 'No subjective topics yet.',
    'menu.lastScore': (score) => `Last score ${score}%`,
    'menu.notAttempted': (count) => `${count} questions · not attempted`,
    'menu.questionCount': (count) => `${count} questions`,
    'menu.searchPlaceholder': 'Search saved topics…',
    'menu.noMatches': 'No topics match your search.',
    'menu.tagAll': 'All',
    'menu.untagged': 'Untagged',
    'home.aria': 'Go home',
    'tab.objective': 'Objective',
    'tab.subjective': 'Subjective',
    'home.obj.title': 'New objective test',
    'home.obj.hint': 'Enter a topic. 30 fresh MCQs in UPSC / UPPCS style, PYQs included.',
    'home.obj.placeholder': 'e.g. Fundamental Rights, Indian Monsoon, Mauryan Administration',
    'home.obj.submit': 'Generate 30 MCQs',
    'home.obj.mixBtn': 'Mix test — 50 questions from all saved topics',
    'home.obj.mixTitle': 'Mix test',
    'home.sub.title': 'New subjective set',
    'home.sub.hint': 'Enter a topic. 5 Mains-style questions, model answers stay hidden until you reveal them.',
    'home.sub.placeholder': 'e.g. Judicial Review, Cropping Patterns of UP, Bureaucracy Reforms',
    'home.sub.submit': 'Generate 5 questions',
    'mix.needMore': 'Generate at least a couple of topics first — mix test draws from your saved question pool.',
    'mix.notEnough': (n) => `Only ${n} saved questions so far — mix test will use all of them.`,
    'mix.ready': (target, total) => `Pulls ${target} questions at random from your ${total} saved questions.`,
    'loading.default': 'Generating questions…',
    'loading.buildingObjectiveBatch': (n, total) => `Building questions ${n}–${Math.min(n + 4, total)} of ${total}…`,
    'loading.buildingSubjective': (topic) => `Drafting 5 Mains-style questions on "${topic}"…`,
    'loading.translating': 'Translating saved questions…',
    'err.noQuestions': 'No questions came back — try a more specific topic.',
    'err.generic': 'Could not generate questions. Check your connection and try again.',
    'err.modelAnswer': 'Could not fetch the model answer. Try again.',
    'err.timeout': 'The request took too long. Please try again.',
    'error.title': "Something didn't work",
    'error.retry': 'Try again',
    'common.backHome': 'Back to home',
    'test.submit': 'Submit test',
    'test.submitLocked': (loaded, total) => `Loading questions… (${loaded}/${total})`,
    'test.generatingNext': 'Generating…',
    'test.prev': '← Previous',
    'test.next': 'Next →',
    'test.paletteAria': 'Question navigator',
    'test.qNumber': (cur, total) => `Question ${cur} of ${total}`,
    'test.qAriaLabel': (n) => `Question ${n}`,
    'test.qAriaLabelPending': (n) => `Question ${n} (not generated yet)`,
    'subj.noAnswerFallback': 'No answer returned — try again.',
    'test.flagAria': 'Flag this question for review',
    'test.flagged': 'Flagged',
    'pyq.tag': 'PYQ',
    'report.title': 'Report card',
    'report.score': 'Score',
    'report.correct': 'Correct',
    'report.wrong': 'Wrong',
    'report.skipped': 'Unattempted',
    'report.retake': 'Retake this test',
    'report.flaggedOnly': 'Flagged only',
    'report.showAll': 'Show all',
    'report.trend': 'Score history',
    'report.trendEmpty': 'No previous attempts yet.',
    'report.trendAttempt': (n) => `Attempt ${n}`,
    'report.explanationHide': 'Hide explanation',
    'report.explanationShow': 'Show explanation',
    'subj.meta': 'Model answer, topper-style — choose a word limit:',
    'subj.words': (wl) => `${wl} words`,
    'subj.writing': 'Writing…',
    'subj.annotateHint': 'Select text in the answer to highlight it and add a note.',
    'subj.noteAdd': 'Add note',
    'subj.notePlaceholder': 'Why did you highlight this? (optional)',
    'subj.noteSave': 'Save',
    'subj.noteCancel': 'Cancel',
    'subj.noteDelete': 'Remove highlight',
    'subj.notesTitle': 'Your highlights',
    'tags.title': 'Tags',
    'tags.none': 'No tag',
    'tags.filterAll': 'All tags',
    'backup.exportBtn': 'Export backup (.json)',
    'backup.importBtn': 'Restore from backup',
    'backup.exportedNothing': 'Nothing to back up yet — generate a topic first.',
    'backup.exportDone': 'Backup downloaded.',
    'backup.invalidFile': 'That file doesn\'t look like a Quebank backup.',
    'backup.confirmReplace': (obj, sub) => `This backup has ${obj} objective and ${sub} subjective topic(s). Choose OK to MERGE it into your current saved topics (nothing is deleted), or Cancel to instead REPLACE everything currently saved with this backup.`,
    'backup.mergeSummary': (addedObj, addedSub, skippedObj, skippedSub) => {
      const parts = [];
      if (addedObj || addedSub) parts.push(`Added ${addedObj} objective and ${addedSub} subjective topic(s).`);
      if (skippedObj || skippedSub) parts.push(`Skipped ${skippedObj + skippedSub} already-saved or invalid entr${skippedObj + skippedSub === 1 ? 'y' : 'ies'}.`);
      return parts.length ? parts.join(' ') : 'Nothing new to add — your backup matches what\'s already saved.';
    },
    'backup.replaceSummary': (obj, sub) => `Replaced saved topics with backup: ${obj} objective, ${sub} subjective.`,
    'backup.readError': 'Could not read that file. Please try again.'
  },
  hi: {
    'menu.open': 'मेन्यू खोलें',
    'menu.close': 'मेन्यू बंद करें',
    'menu.savedTopics': 'सहेजे गए विषय',
    'menu.emptyObj': 'अभी तक कोई ऑब्जेक्टिव विषय नहीं।',
    'menu.emptySub': 'अभी तक कोई सब्जेक्टिव विषय नहीं।',
    'menu.lastScore': (score) => `पिछला स्कोर ${score}%`,
    'menu.notAttempted': (count) => `${count} प्रश्न · अभी हल नहीं किए`,
    'menu.questionCount': (count) => `${count} प्रश्न`,
    'menu.searchPlaceholder': 'सहेजे गए विषय खोजें…',
    'menu.noMatches': 'आपकी खोज से कोई विषय मेल नहीं खाता।',
    'menu.tagAll': 'सभी',
    'menu.untagged': 'बिना टैग',
    'home.aria': 'होम पर जाएं',
    'tab.objective': 'ऑब्जेक्टिव',
    'tab.subjective': 'सब्जेक्टिव',
    'home.obj.title': 'नया ऑब्जेक्टिव टेस्ट',
    'home.obj.hint': 'एक विषय लिखें। UPSC / UPPCS शैली में 30 ताज़ा MCQ, PYQ सहित।',
    'home.obj.placeholder': 'जैसे मौलिक अधिकार, भारतीय मानसून, मौर्य प्रशासन',
    'home.obj.submit': '30 MCQ जनरेट करें',
    'home.obj.mixBtn': 'मिक्स टेस्ट — सभी सहेजे गए विषयों से 50 प्रश्न',
    'home.obj.mixTitle': 'मिक्स टेस्ट',
    'home.sub.title': 'नया सब्जेक्टिव सेट',
    'home.sub.hint': 'एक विषय लिखें। 5 मेन्स-शैली प्रश्न — मॉडल उत्तर तब तक छिपे रहेंगे जब तक आप उन्हें नहीं खोलते।',
    'home.sub.placeholder': 'जैसे न्यायिक समीक्षा, उत्तर प्रदेश की फसल पद्धतियाँ, नौकरशाही सुधार',
    'home.sub.submit': '5 प्रश्न जनरेट करें',
    'mix.needMore': 'पहले कम से कम कुछ विषय जनरेट करें — मिक्स टेस्ट आपके सहेजे गए प्रश्न-भंडार से बनता है।',
    'mix.notEnough': (n) => `अभी तक केवल ${n} प्रश्न सहेजे गए हैं — मिक्स टेस्ट इन सभी का उपयोग करेगा।`,
    'mix.ready': (target, total) => `आपके ${total} सहेजे गए प्रश्नों में से बेतरतीब ढंग से ${target} प्रश्न चुनता है।`,
    'loading.default': 'प्रश्न तैयार किए जा रहे हैं…',
    'loading.buildingObjectiveBatch': (n, total) => `प्रश्न ${n}–${Math.min(n + 4, total)} / ${total} तैयार किए जा रहे हैं…`,
    'loading.buildingSubjective': (topic) => `"${topic}" पर 5 मेन्स-शैली प्रश्न तैयार किए जा रहे हैं…`,
    'loading.translating': 'सहेजे गए प्रश्नों का अनुवाद किया जा रहा है…',
    'err.noQuestions': 'कोई प्रश्न नहीं मिला — कृपया अधिक स्पष्ट विषय आज़माएँ।',
    'err.generic': 'प्रश्न जनरेट नहीं हो सके। अपना कनेक्शन जांचें और फिर से प्रयास करें।',
    'err.modelAnswer': 'मॉडल उत्तर नहीं मिल सका। फिर से प्रयास करें।',
    'err.timeout': 'अनुरोध में बहुत अधिक समय लग गया। कृपया फिर से प्रयास करें।',
    'error.title': 'कुछ गड़बड़ हो गई',
    'error.retry': 'फिर से प्रयास करें',
    'common.backHome': 'होम पर वापस जाएं',
    'test.submit': 'टेस्ट सबमिट करें',
    'test.submitLocked': (loaded, total) => `प्रश्न लोड हो रहे हैं… (${loaded}/${total})`,
    'test.generatingNext': 'जनरेट किया जा रहा है…',
    'test.prev': '← पिछला',
    'test.next': 'अगला →',
    'test.paletteAria': 'प्रश्न नेविगेटर',
    'test.qNumber': (cur, total) => `प्रश्न ${cur} / ${total}`,
    'test.qAriaLabel': (n) => `प्रश्न ${n}`,
    'test.qAriaLabelPending': (n) => `प्रश्न ${n} (अभी जनरेट नहीं हुआ)`,
    'subj.noAnswerFallback': 'उत्तर नहीं मिला — कृपया फिर से प्रयास करें।',
    'test.flagAria': 'समीक्षा के लिए इस प्रश्न को फ़्लैग करें',
    'test.flagged': 'फ़्लैग किया गया',
    'pyq.tag': 'PYQ',
    'report.title': 'रिपोर्ट कार्ड',
    'report.score': 'स्कोर',
    'report.correct': 'सही',
    'report.wrong': 'गलत',
    'report.skipped': 'अनुत्तरित',
    'report.retake': 'यह टेस्ट फिर से लें',
    'report.flaggedOnly': 'केवल फ़्लैग किए गए',
    'report.showAll': 'सभी दिखाएं',
    'report.trend': 'स्कोर इतिहास',
    'report.trendEmpty': 'अभी तक कोई पिछला प्रयास नहीं।',
    'report.trendAttempt': (n) => `प्रयास ${n}`,
    'report.explanationHide': 'व्याख्या छुपाएं',
    'report.explanationShow': 'व्याख्या दिखाएं',
    'subj.meta': 'मॉडल उत्तर, टॉपर-स्टाइल — शब्द सीमा चुनें:',
    'subj.words': (wl) => `${wl} शब्द`,
    'subj.writing': 'लिखा जा रहा है…',
    'subj.annotateHint': 'हाइलाइट करने और नोट जोड़ने के लिए उत्तर में टेक्स्ट चुनें।',
    'subj.noteAdd': 'नोट जोड़ें',
    'subj.notePlaceholder': 'आपने यह क्यों हाइलाइट किया? (वैकल्पिक)',
    'subj.noteSave': 'सहेजें',
    'subj.noteCancel': 'रद्द करें',
    'subj.noteDelete': 'हाइलाइट हटाएं',
    'subj.notesTitle': 'आपके हाइलाइट्स',
    'tags.title': 'टैग',
    'tags.none': 'कोई टैग नहीं',
    'tags.filterAll': 'सभी टैग',
    'backup.exportBtn': 'बैकअप एक्सपोर्ट करें (.json)',
    'backup.importBtn': 'बैकअप से रीस्टोर करें',
    'backup.exportedNothing': 'अभी बैकअप के लिए कुछ नहीं है — पहले कोई विषय जनरेट करें।',
    'backup.exportDone': 'बैकअप डाउनलोड हो गया।',
    'backup.invalidFile': 'यह फ़ाइल Quebank बैकअप जैसी नहीं लगती।',
    'backup.confirmReplace': (obj, sub) => `इस बैकअप में ${obj} ऑब्जेक्टिव और ${sub} सब्जेक्टिव विषय हैं। इसे अपने वर्तमान सहेजे गए विषयों में MERGE (मिलाने) के लिए OK चुनें (कुछ भी हटेगा नहीं), या इसके बजाय वर्तमान में सहेजे गए सभी विषयों को इस बैकअप से REPLACE (बदलने) के लिए Cancel चुनें।`,
    'backup.mergeSummary': (addedObj, addedSub, skippedObj, skippedSub) => {
      const parts = [];
      if (addedObj || addedSub) parts.push(`${addedObj} ऑब्जेक्टिव और ${addedSub} सब्जेक्टिव विषय जोड़े गए।`);
      if (skippedObj || skippedSub) parts.push(`${skippedObj + skippedSub} पहले से सहेजी गई या अमान्य प्रविष्टियाँ छोड़ी गईं।`);
      return parts.length ? parts.join(' ') : 'जोड़ने के लिए कुछ नया नहीं — आपका बैकअप पहले से सहेजे गए डेटा से मेल खाता है।';
    },
    'backup.replaceSummary': (obj, sub) => `सहेजे गए विषय बैकअप से बदले गए: ${obj} ऑब्जेक्टिव, ${sub} सब्जेक्टिव।`,
    'backup.readError': 'वह फ़ाइल पढ़ी नहीं जा सकी। कृपया फिर से प्रयास करें।'
  }
};

let currentLang = (localStorage.getItem(LS_LANG) === 'hi') ? 'hi' : 'en';
let currentScreenRerender = null; // re-render hook for whatever screen is on-screen, used on language switch

function t(key, ...args){
  const dict = I18N[currentLang] || I18N.en;
  const val = (key in dict) ? dict[key] : I18N.en[key];
  if (typeof val === 'function') return val(...args);
  return val !== undefined ? val : key;
}

// Applies every data-i18n / data-i18n-placeholder / data-i18n-aria attribute
// found under `root` using the current language. Safe to call repeatedly —
// it only touches elements carrying those attributes.
function applyI18n(root){
  root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.getAttribute('data-i18n')); });
  root.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.getAttribute('data-i18n-placeholder')); });
  root.querySelectorAll('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria'))); });
}

function updateLangButtons(){
  document.querySelectorAll('.langBtn').forEach(b => {
    const active = b.dataset.lang === currentLang;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

let openSubjectiveId = null; // tracks which saved subjective topic (if any) is on-screen

async function setLang(lang){
  if (lang !== 'en' && lang !== 'hi') return;
  currentLang = lang;
  localStorage.setItem(LS_LANG, lang);
  document.documentElement.lang = lang;
  updateLangButtons();
  applyI18n(document);
  renderMenu();

  // If a saved (non-mix) objective test is currently on-screen, translate
  // it in place so the questions the user is looking at switch too, not
  // just the surrounding UI chrome.
  if (testState && testState.topicId && !testState.isMix){
    const entry = loadObjTopics().find(x => x.id === testState.topicId);
    if (entry && (entry.lang || 'en') !== currentLang){
      try {
        await ensureObjectiveEntryLang(entry, currentLang);
        const byId = {};
        entry.questions.forEach(q => { byId[q.id] = q; });
        testState.questions = testState.questions.map(q => byId[q.id] || q);
      } catch (err){ /* leave current-language content on-screen if translation fails */ }
    }
  }

  // Same idea for a saved subjective set currently on-screen — showSubjectiveSet
  // re-reads from storage on rerender, so translating the stored entry here
  // is enough for the rerender below to pick up the new language.
  if (openSubjectiveId){
    const entry = loadSubTopics().find(x => x.id === openSubjectiveId);
    if (entry && (entry.lang || 'en') !== currentLang){
      try { await ensureSubjectiveEntryLang(entry, currentLang); }
      catch (err){ /* leave current-language content on-screen if translation fails */ }
    }
  }

  if (typeof currentScreenRerender === 'function') currentScreenRerender();
}

// ---------- storage helpers ----------
function loadObjTopics(){ return JSON.parse(localStorage.getItem(LS_OBJ) || '[]'); }
function saveObjTopics(list){ localStorage.setItem(LS_OBJ, JSON.stringify(list)); }
function loadSubTopics(){ return JSON.parse(localStorage.getItem(LS_SUB) || '[]'); }
function saveSubTopics(list){ localStorage.setItem(LS_SUB, JSON.stringify(list)); }
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

// ---------- API helper ----------
// Reliability notes:
// - Every request to the Netlify function has a client-side timeout so a
//   dropped/hanging connection fails fast instead of leaving the loading
//   screen stuck indefinitely.
// - Every request gets one silent automatic retry on a transient failure
//   (timeout, network error, or a 502/503/504 from the server) before the
//   error is surfaced to the user. The server itself also retries against
//   Gemini internally, so together this covers both link failures.
// - Non-transient failures (e.g. a 400 for a bad request, or a 500 for a
//   missing API key) are not retried — retrying won't fix them.
const REQUEST_TIMEOUT_MS = 20000;
const CLIENT_RETRY_DELAY_MS = 600;
// Gemini's free-tier requests-per-minute limit is shared across the whole
// project/API key, not per feature — so a burst of objective-batch fetches
// followed immediately by subjective model-answer fetches (or vice versa)
// draws from the same bucket and can trip 429 even though each call alone
// would be fine. This spaces out every call to the Netlify function (any
// action) by at least MIN_CALL_INTERVAL_MS, self-throttling client-side
// instead of relying solely on server-side retry after the fact.
// ~4.5s keeps us under ~13 calls/minute, comfortably under free-tier RPM
// limits (roughly 10-15 RPM as of 2026) even with some clock drift.
const MIN_CALL_INTERVAL_MS = 4500;
let lastCallAt = 0;

async function throttleCall(){
  const wait = lastCallAt + MIN_CALL_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
}

async function postToGenerate(body){
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify(body)
    });
    if (!res.ok){
      let msg = 'The question generator did not respond.';
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch(e){}
      const err = new Error(msg);
      err.transient = res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504;
      throw err;
    }
    return await res.json();
  } catch (err){
    if (err.name === 'AbortError'){
      const timeoutErr = new Error(t('err.timeout'));
      timeoutErr.transient = true;
      throw timeoutErr;
    }
    if (err instanceof TypeError){
      // fetch() throws a bare TypeError on network-level failure (offline, DNS, etc.)
      err.transient = true;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function postWithRetry(body){
  try {
    return await postToGenerate(body);
  } catch (err){
    if (err.transient){
      await sleep(CLIENT_RETRY_DELAY_MS);
      return await postToGenerate(body); // one silent retry; a second failure surfaces to the caller
    }
    throw err;
  }
}

function sleep(ms){ return new Promise(resolve => setTimeout(resolve, ms)); }

// If window.QUEBANK_MOCK_GENERATE is defined (see demo-data.js), use it instead
// of calling the Netlify function — this is what lets demo.html run with zero
// deployment and zero Gemini key. Production (index.html) never defines it.
async function callGenerate(payload){
  const body = { ...payload, lang: currentLang };
  if (typeof window.QUEBANK_MOCK_GENERATE === 'function'){
    return window.QUEBANK_MOCK_GENERATE(body); // demo mode never touches Gemini, so no throttling needed
  }
  await throttleCall();
  return postWithRetry(body);
}

async function callTranslate(texts, targetLang){
  if (!texts.length) return [];
  const body = { action: 'translate', lang: targetLang, texts };
  let data;
  if (typeof window.QUEBANK_MOCK_GENERATE === 'function'){
    data = await window.QUEBANK_MOCK_GENERATE(body);
  } else {
    data = await postWithRetry(body);
  }
  if (!data || !Array.isArray(data.texts) || data.texts.length !== texts.length){
    throw new Error('Translation response did not match.');
  }
  return data.texts;
}

function persistObjEntry(entry){
  const list = loadObjTopics();
  const idx = list.findIndex(x => x.id === entry.id);
  if (idx !== -1){ list[idx] = entry; saveObjTopics(list); }
}
function persistSubEntry(entry){
  const list = loadSubTopics();
  const idx = list.findIndex(x => x.id === entry.id);
  if (idx !== -1){ list[idx] = entry; saveSubTopics(list); }
}

// A saved topic keeps whatever language it was generated in until it's
// opened (test started / subjective set viewed / pulled into a mix test)
// while the UI is set to a different language — at that point it's
// translated with one Gemini call, and both language versions are cached
// on the entry so switching back and forth afterwards is instant and free.
async function ensureObjectiveEntryLang(entry, targetLang){
  if ((entry.lang || 'en') === targetLang) return entry;
  if (!entry.cache) entry.cache = {};
  entry.cache[entry.lang || 'en'] = entry.cache[entry.lang || 'en'] || entry.questions;
  if (entry.cache[targetLang]){
    entry.questions = entry.cache[targetLang];
    entry.lang = targetLang;
    persistObjEntry(entry);
    return entry;
  }
  const texts = [];
  const layout = [];
  entry.questions.forEach((q, qi) => {
    texts.push(q.question); layout.push([qi, 'question']);
    q.options.forEach((opt, oi) => { texts.push(opt); layout.push([qi, 'option', oi]); });
    texts.push(q.explanation || ''); layout.push([qi, 'explanation']);
  });
  const translated = await callTranslate(texts, targetLang);
  const newQuestions = entry.questions.map(q => ({ ...q, options: [...q.options] }));
  layout.forEach((loc, idx) => {
    const [qi, field, oi] = loc;
    if (field === 'question') newQuestions[qi].question = translated[idx];
    else if (field === 'option') newQuestions[qi].options[oi] = translated[idx];
    else if (field === 'explanation') newQuestions[qi].explanation = translated[idx];
  });
  entry.cache[targetLang] = newQuestions;
  entry.questions = newQuestions;
  entry.lang = targetLang;
  persistObjEntry(entry);
  return entry;
}

async function ensureSubjectiveEntryLang(entry, targetLang){
  if ((entry.lang || 'en') === targetLang) return entry;
  if (!entry.cache) entry.cache = {};
  entry.cache[entry.lang || 'en'] = entry.cache[entry.lang || 'en'] || entry.questions;
  if (entry.cache[targetLang]){
    entry.questions = entry.cache[targetLang];
    entry.lang = targetLang;
    persistSubEntry(entry);
    return entry;
  }
  const texts = [];
  const layout = [];
  entry.questions.forEach((q, qi) => {
    texts.push(q.question); layout.push([qi, 'question']);
    Object.keys(q.modelAnswers || {}).forEach(wl => {
      texts.push(q.modelAnswers[wl]); layout.push([qi, 'answer', wl]);
    });
  });
  const translated = await callTranslate(texts, targetLang);
  // Highlights are saved as character offsets into a specific answer's text,
  // so they don't carry over to a freshly-translated copy of that answer
  // (the offsets would land on the wrong characters). The original-language
  // cached copy keeps its own annotations untouched; only this new
  // translated copy starts blank, per word limit.
  const newQuestions = entry.questions.map(q => ({ ...q, modelAnswers: { ...(q.modelAnswers || {}) }, annotations: {} }));
  layout.forEach((loc, idx) => {
    const [qi, field, wl] = loc;
    if (field === 'question') newQuestions[qi].question = translated[idx];
    else if (field === 'answer') newQuestions[qi].modelAnswers[wl] = translated[idx];
  });
  entry.cache[targetLang] = newQuestions;
  entry.questions = newQuestions;
  entry.lang = targetLang;
  persistSubEntry(entry);
  return entry;
}

// ---------- view rendering ----------
function clone(tplId){
  return document.getElementById(tplId).content.cloneNode(true);
}
function render(node){
  app.innerHTML = '';
  app.appendChild(node);
  applyI18n(document);
}

function showLoading(text){
  currentScreenRerender = null;
  const n = clone('tpl-loading');
  render(n);
  document.getElementById('loadingText').textContent = text || t('loading.default');
}

function showError(message, onRetry){
  currentScreenRerender = null;
  const n = clone('tpl-error');
  render(n);
  document.getElementById('errorText').textContent = message;
  document.getElementById('errorRetryBtn').addEventListener('click', () => {
    if (onRetry) onRetry(); else showHome();
  });
  document.getElementById('errorHomeBtn').addEventListener('click', showHome);
}

// ---------- HOME ----------
let homeMode = 'objective';

function showHome(preferredMode){
  if (preferredMode) homeMode = preferredMode;
  openSubjectiveId = null;
  currentScreenRerender = () => showHome(homeMode);
  const n = clone('tpl-home');
  render(n);
  closeMenu();

  const modeTabs = app.querySelectorAll('.modeTab');
  const panels = { objective: app.querySelector('[data-panel="objective"]'), subjective: app.querySelector('[data-panel="subjective"]') };

  function setMode(mode){
    homeMode = mode;
    modeTabs.forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
    panels.objective.classList.toggle('hidden', mode !== 'objective');
    panels.subjective.classList.toggle('hidden', mode !== 'subjective');
  }
  modeTabs.forEach(t => t.addEventListener('click', () => setMode(t.dataset.mode)));
  setMode(homeMode);

  document.getElementById('objForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const topic = document.getElementById('objTopicInput').value.trim();
    if (topic) generateObjectiveTopic(topic);
  });
  document.getElementById('subForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const topic = document.getElementById('subTopicInput').value.trim();
    if (topic) generateSubjectiveTopic(topic);
  });

  const objTopics = loadObjTopics();
  const totalSaved = objTopics.reduce((s, t) => s + t.questions.length, 0);
  const mixHint = document.getElementById('mixTestHint');
  const mixBtn = document.getElementById('mixTestBtn');
  if (totalSaved < 10){
    mixBtn.disabled = true;
    mixHint.textContent = t('mix.needMore');
  } else {
    mixHint.textContent = totalSaved < MIX_TARGET
      ? t('mix.notEnough', totalSaved)
      : t('mix.ready', MIX_TARGET, totalSaved);
  }
  mixBtn.addEventListener('click', startMixTest);

  renderMenu();
}

// ---------- OBJECTIVE: generate ----------
// Objective generation happens in batches of OBJ_BATCH_SIZE (5) rather than
// all 30 at once — free-tier Gemini is unreliable/slow with a single 30-MCQ
// call. The first batch starts the test immediately; remaining batches are
// fetched lazily as the user reaches the end of what's currently loaded (see
// maybeFetchNextObjectiveBatch), each one telling Gemini which questions
// already exist so it doesn't repeat them.
async function generateObjectiveTopic(topic){
  showLoading(t('loading.buildingObjectiveBatch', 1, OBJ_PER_TOPIC));
  try {
    const data = await callGenerate({ action: 'objective', topic, count: OBJ_BATCH_SIZE });
    const questions = parseObjectiveQuestions(data);
    if (questions.length === 0) throw new Error(t('err.noQuestions'));
    const entry = {
      id: uid(), topic, createdAt: Date.now(), questions,
      totalPlanned: OBJ_PER_TOPIC, lastResult: null, history: [], flags: {}, tags: [],
      lang: currentLang, cache: {}
    };
    const list = loadObjTopics();
    list.unshift(entry);
    saveObjTopics(list);
    startTest(entry.questions, { title: topic, topicId: entry.id, isMix: false, totalPlanned: entry.totalPlanned });
  } catch (err){
    showError(err.message || t('err.generic'), () => generateObjectiveTopic(topic));
  }
}

function parseObjectiveQuestions(data){
  return (data.questions || [])
    .filter(q => q && typeof q.question === 'string' && Array.isArray(q.options) && q.options.length === 4 && q.correctIndex !== undefined)
    .map(q => ({
      id: uid(),
      question: q.question,
      options: q.options,
      correctIndex: Number(q.correctIndex),
      explanation: q.explanation || '',
      pyq: !!q.pyq,
      pyqSource: q.pyqSource || null
    }));
}

// Fetches the next batch for the topic currently being taken, if the plan
// calls for more than what's loaded. De-dupes against every question text
// already loaded — both defensively client-side (exact-text match) and by
// telling Gemini server-side which questions to avoid repeating.
// Fetches the next batch(es) for the topic currently being taken, if the plan
// calls for more than what's loaded. De-dupes against every question text
// already loaded — both server-side (excludeQuestions tells Gemini what to
// avoid) and client-side (exact-text match on the response, since a
// schema-constrained call can still occasionally echo one back anyway). If
// de-dupe drops the batch below what was asked for, tops up with another
// request rather than silently leaving the topic short — bounded by
// MAX_BATCH_TOPUPS so a persistently unhelpful API surfaces an error instead
// of looping forever.
const MAX_BATCH_TOPUPS = 4;

// True while a next-batch fetch is in flight. Guards against a race where the
// user navigates away (Previous, or an already-loaded palette dot) while the
// fetch triggered by "Next" is still pending: without this, testState.current
// could be changed by that other navigation during the await, and then get
// silently clobbered back to the batch's target index once the fetch
// resolves and moveQuestion() resumes. Checked by moveQuestion() and the
// palette dot click handler, and used here to disable Previous/dots too
// (Next is already disabled below) so navigation is fully locked during a
// batch fetch, not just visually on the Next button.
let batchFetchInProgress = false;

async function maybeFetchNextObjectiveBatch(){
  if (!testState || testState.isMix || !testState.topicId) return true; // nothing to fetch (mix tests / retakes are always fully loaded already)
  const planned = testState.totalPlanned || testState.questions.length;
  if (testState.questions.length >= planned) return true; // already complete

  const nextBtn = document.getElementById('nextQBtn');
  const prevBtn = document.getElementById('prevQBtn');
  const prevLabel = nextBtn ? nextBtn.textContent : null;
  const prevBtnWasDisabled = prevBtn ? prevBtn.disabled : false;
  batchFetchInProgress = true;
  if (nextBtn){ nextBtn.disabled = true; nextBtn.textContent = t('test.generatingNext'); }
  if (prevBtn){ prevBtn.disabled = true; }

  try {
    const remaining = planned - testState.questions.length;
    const targetBatchSize = Math.min(OBJ_BATCH_SIZE, remaining);
    const collected = [];
    const seen = new Set(testState.questions.map(q => normalizeQuestionText(q.question)));

    for (let attempt = 0; collected.length < targetBatchSize && attempt <= MAX_BATCH_TOPUPS; attempt++){
      const stillNeeded = targetBatchSize - collected.length;
      const existingTexts = testState.questions.map(q => q.question).concat(collected.map(q => q.question));
      const data = await callGenerate({
        action: 'objective', topic: testState.title,
        count: stillNeeded, excludeQuestions: existingTexts
      });
      const fresh = parseObjectiveQuestions(data).filter(q => {
        const key = normalizeQuestionText(q.question);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      collected.push(...fresh);
      if (fresh.length === 0 && attempt === MAX_BATCH_TOPUPS){
        // Every attempt (including top-ups) came back empty after de-dupe —
        // give up rather than loop indefinitely against an unhelpful API.
        break;
      }
    }

    if (collected.length === 0) throw new Error(t('err.noQuestions'));
    // Accept a partial batch rather than blocking forever if top-ups are
    // exhausted — the user still gets some new questions now, and the next
    // "Next" click will simply try again for the remainder.
    const newQuestions = collected.slice(0, targetBatchSize);

    testState.questions = testState.questions.concat(newQuestions);
    const list = loadObjTopics();
    const entry = list.find(x => x.id === testState.topicId);
    if (entry){
      entry.questions = entry.questions.concat(newQuestions);
      saveObjTopics(list);
    }
    return true;
  } catch (err){
    showError(err.message || t('err.generic'), () => { showRestoredTest(); });
    return false;
  } finally {
    batchFetchInProgress = false;
    if (nextBtn){ nextBtn.textContent = prevLabel; }
    if (prevBtn){ prevBtn.disabled = prevBtnWasDisabled; }
  }
}

function normalizeQuestionText(s){
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Re-shows the in-progress test after a failed batch fetch, so "Retry" from
// the error screen doesn't lose the user's answers so far.
function showRestoredTest(){
  if (testState){ renderTest(); }
  else { showHome('objective'); }
}

async function startMixTest(){
  const list = loadObjTopics();
  if (list.length === 0){ return; }
  const needsTranslation = list.some(entry => (entry.lang || 'en') !== currentLang);
  if (needsTranslation){
    showLoading(t('loading.translating'));
    try {
      for (const entry of list){
        await ensureObjectiveEntryLang(entry, currentLang);
      }
    } catch (err){
      showError(err.message || t('err.generic'), startMixTest);
      return;
    }
  }
  const freshList = loadObjTopics();
  let pool = [];
  freshList.forEach(entry => entry.questions.forEach(q => pool.push(q)));
  if (pool.length === 0){ return; }
  // shuffle
  for (let i = pool.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const selected = pool.slice(0, Math.min(MIX_TARGET, pool.length));
  startTest(selected, { title: t('home.obj.mixTitle'), topicId: null, isMix: true });
}

// Opens a saved objective topic from the menu, translating it into the
// current UI language first if it was generated in a different one.
async function openObjectiveTopic(topicId){
  const list = loadObjTopics();
  const entry = list.find(x => x.id === topicId);
  if (!entry){ showHome('objective'); return; }
  if ((entry.lang || 'en') !== currentLang){
    showLoading(t('loading.translating'));
    try {
      await ensureObjectiveEntryLang(entry, currentLang);
    } catch (err){
      showError(err.message || t('err.generic'), () => openObjectiveTopic(topicId));
      return;
    }
  }
  startTest(entry.questions, { title: entry.topic, topicId: entry.id, isMix: false, totalPlanned: entry.totalPlanned });
}

// Opens a saved subjective topic from the menu, translating it (including
// any already-fetched model answers) into the current UI language first.
async function openSubjectiveTopic(topicId){
  const list = loadSubTopics();
  const entry = list.find(x => x.id === topicId);
  if (!entry){ showHome('subjective'); return; }
  if ((entry.lang || 'en') !== currentLang){
    showLoading(t('loading.translating'));
    try {
      await ensureSubjectiveEntryLang(entry, currentLang);
    } catch (err){
      showError(err.message || t('err.generic'), () => openSubjectiveTopic(topicId));
      return;
    }
  }
  showSubjectiveSet(entry.id);
}

// ---------- TEST ENGINE ----------
let testState = null;

function startTest(questions, meta){
  testState = {
    questions,
    answers: {},
    current: 0,
    title: meta.title,
    topicId: meta.topicId,
    isMix: meta.isMix,
    totalPlanned: meta.totalPlanned || questions.length, // full plan size; may exceed questions.length while batches are still loading
    flags: loadFlagsForQuestions(questions) // question-level flags persist across retakes/mix tests, keyed by question id
  };
  renderTest();
}

// Flags live on each question's owning objective topic entry (entry.flags,
// keyed by question id) so a flag set during a mix test still shows up when
// that question is later encountered in its own topic test, and vice versa.
function loadFlagsForQuestions(questions){
  const list = loadObjTopics();
  const byQId = {};
  list.forEach(entry => {
    if (!entry.flags) entry.flags = {};
    entry.questions.forEach(q => { byQId[q.id] = entry; });
  });
  const flags = {};
  questions.forEach(q => {
    const owner = byQId[q.id];
    if (owner && owner.flags && owner.flags[q.id]) flags[q.id] = true;
  });
  return flags;
}

function toggleFlag(questionId){
  if (!testState) return;
  const isFlagged = !!testState.flags[questionId];
  if (isFlagged) delete testState.flags[questionId];
  else testState.flags[questionId] = true;

  const list = loadObjTopics();
  const owner = list.find(entry => entry.questions.some(q => q.id === questionId));
  if (owner){
    if (!owner.flags) owner.flags = {};
    if (isFlagged) delete owner.flags[questionId];
    else owner.flags[questionId] = true;
    saveObjTopics(list);
  }
}

function renderTest(){
  currentScreenRerender = renderTest;
  openSubjectiveId = null;
  const n = clone('tpl-test');
  render(n);
  closeMenu();
  document.getElementById('testTopicTitle').textContent = testState.title;
  document.getElementById('submitTestBtn').addEventListener('click', submitTest);
  document.getElementById('prevQBtn').addEventListener('click', () => moveQuestion(-1));
  document.getElementById('nextQBtn').addEventListener('click', () => moveQuestion(1));
  document.getElementById('qFlagBtn').addEventListener('click', () => {
    const q = testState.questions[testState.current];
    toggleFlag(q.id);
    renderQuestion();
    renderPalette();
  });
  renderPalette();
  renderQuestion();
}

function renderPalette(){
  const pal = document.getElementById('qPalette');
  pal.innerHTML = '';
  const planned = testState.totalPlanned || testState.questions.length;
  for (let i = 0; i < planned; i++){
    const loaded = i < testState.questions.length;
    const dot = document.createElement('button');
    if (loaded){
      const q = testState.questions[i];
      dot.className = 'qDot' + (testState.answers[q.id] !== undefined ? ' answered' : '') + (i === testState.current ? ' current' : '') + (testState.flags[q.id] ? ' flagged' : '');
      dot.textContent = i + 1;
      dot.setAttribute('aria-label', t('test.qAriaLabel', i + 1));
      dot.addEventListener('click', () => {
        if (batchFetchInProgress) return; // locked while a next-batch fetch is resolving, see maybeFetchNextObjectiveBatch
        testState.current = i; renderQuestion(); renderPalette();
      });
    } else {
      dot.className = 'qDot qDot--pending';
      dot.textContent = i + 1;
      dot.disabled = true;
      dot.setAttribute('aria-label', t('test.qAriaLabelPending', i + 1));
    }
    pal.appendChild(dot);
  }
}

function renderQuestion(){
  const q = testState.questions[testState.current];
  const planned = testState.totalPlanned || testState.questions.length;
  document.getElementById('qNumber').textContent = t('test.qNumber', testState.current + 1, planned);
  const pyqTag = document.getElementById('qPyqTag');
  if (q.pyq){ pyqTag.classList.remove('hidden'); pyqTag.textContent = q.pyqSource ? `${t('pyq.tag')} · ${q.pyqSource}` : t('pyq.tag'); }
  else { pyqTag.classList.add('hidden'); }
  const flagBtn = document.getElementById('qFlagBtn');
  const isFlagged = !!testState.flags[q.id];
  flagBtn.classList.toggle('active', isFlagged);
  flagBtn.setAttribute('aria-pressed', isFlagged ? 'true' : 'false');
  document.getElementById('qText').textContent = q.question;

  const opts = document.getElementById('qOptions');
  opts.innerHTML = '';
  const letters = ['A', 'B', 'C', 'D'];
  q.options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'qOpt' + (testState.answers[q.id] === i ? ' selected' : '');
    btn.innerHTML = `<span class="optLetter">${letters[i]}</span><span>${escapeHtml(opt)}</span>`;
    btn.addEventListener('click', () => {
      testState.answers[q.id] = i;
      renderQuestion();
      renderPalette();
    });
    opts.appendChild(btn);
  });

  document.getElementById('prevQBtn').disabled = testState.current === 0;
  document.getElementById('nextQBtn').disabled = testState.current === planned - 1;

  const submitBtn = document.getElementById('submitTestBtn');
  const complete = testState.questions.length >= planned;
  submitBtn.disabled = !complete;
  submitBtn.textContent = complete ? t('test.submit') : t('test.submitLocked', testState.questions.length, planned);
}

async function moveQuestion(delta){
  if (batchFetchInProgress) return; // navigation is locked while a batch fetch is resolving, see maybeFetchNextObjectiveBatch
  const next = testState.current + delta;
  const planned = testState.totalPlanned || testState.questions.length;
  if (next < 0 || next >= planned) return;
  if (next >= testState.questions.length){
    // Stepping past what's currently loaded — fetch the next batch first.
    const ok = await maybeFetchNextObjectiveBatch();
    if (!ok || next >= testState.questions.length) return; // fetch failed or still short (shouldn't happen, but stay put rather than go out of bounds
  }
  testState.current = next;
  renderQuestion();
  renderPalette();
}

function submitTest(){
  const planned = testState.totalPlanned || testState.questions.length;
  if (testState.questions.length < planned) return; // guard: submit button is disabled until fully loaded, but don't trust that alone
  const { questions, answers } = testState;
  let correct = 0, wrong = 0, skipped = 0;
  questions.forEach(q => {
    if (answers[q.id] === undefined) skipped++;
    else if (answers[q.id] === q.correctIndex) correct++;
    else wrong++;
  });
  const total = questions.length;
  const score = Math.round((correct / total) * 100);
  const result = { correct, wrong, skipped, total, score, answers, takenAt: Date.now() };

  let history = [];
  if (testState.topicId && !testState.isMix){
    const list = loadObjTopics();
    const entry = list.find(x => x.id === testState.topicId);
    if (entry){
      entry.lastResult = result;
      if (!Array.isArray(entry.history)) entry.history = [];
      entry.history.push({ score, correct, wrong, skipped, total, takenAt: result.takenAt });
      if (entry.history.length > SCORE_HISTORY_MAX) entry.history = entry.history.slice(-SCORE_HISTORY_MAX);
      history = entry.history;
    }
    saveObjTopics(list);
  }

  showReport(result, testState.title, questions, answers, { topicId: testState.topicId, isMix: testState.isMix, flags: testState.flags, history });
}

function showReport(result, title, questions, answers, meta){
  meta = meta || {};
  currentScreenRerender = () => showReport(result, title, questions, answers, meta);
  const n = clone('tpl-report');
  render(n);
  document.getElementById('reportTopicTitle').textContent = title;
  document.getElementById('scScore').textContent = result.score + '%';
  document.getElementById('scCorrect').textContent = result.correct;
  document.getElementById('scWrong').textContent = result.wrong;
  document.getElementById('scSkipped').textContent = result.skipped;

  // Retake — re-runs the exact same question set (same order, same ids),
  // separate from generating a new topic or pulling a fresh mix test.
  const retakeBtn = document.getElementById('reportRetakeBtn');
  retakeBtn.addEventListener('click', () => {
    // By the time a report exists, the topic's full plan was already loaded
    // (submitTest blocks submission until all batches are in) — so a retake
    // always has the complete set already.
    startTest(questions, { title, topicId: meta.topicId, isMix: meta.isMix, totalPlanned: questions.length });
  });

  // Score history / trend — only meaningful for a saved, non-mix topic
  // (a mix test's "topic" is a different random draw each time).
  const trendWrap = document.getElementById('reportTrend');
  const flags = meta.flags || {};
  if (meta.topicId && !meta.isMix){
    trendWrap.classList.remove('hidden');
    renderScoreTrend(trendWrap, meta.history || []);
  } else {
    trendWrap.classList.add('hidden');
  }

  const flagToggle = document.getElementById('reviewFlagToggle');
  const hasFlags = questions.some(q => flags[q.id]);
  flagToggle.classList.toggle('hidden', !hasFlags);
  let showFlaggedOnly = false;

  const list = document.getElementById('reviewList');
  const letters = ['A', 'B', 'C', 'D'];

  function renderReviewList(){
    list.innerHTML = '';
    questions.forEach((q, i) => {
      if (showFlaggedOnly && !flags[q.id]) return;
      const picked = answers[q.id];
      const status = picked === undefined ? 'skipped' : (picked === q.correctIndex ? 'correct' : 'wrong');
      const item = document.createElement('div');
      item.className = 'reviewItem ' + status;
      let optsHtml = '';
      q.options.forEach((opt, oi) => {
        let cls = '';
        if (oi === q.correctIndex) cls = 'isCorrect';
        else if (oi === picked) cls = 'isWrongPicked';
        optsHtml += `<div class="reviewOpt ${cls}">${letters[oi]}. ${escapeHtml(opt)}</div>`;
      });
      const flagMark = flags[q.id] ? `<span class="reviewFlagMark" aria-hidden="true">🚩</span>` : '';
      item.innerHTML = `
        <p class="reviewQ">${flagMark}<strong>Q${i + 1}.</strong> ${escapeHtml(q.question)}</p>
        ${optsHtml}
        ${q.explanation ? `<button type="button" class="explToggleBtn">${t('report.explanationShow')}</button><p class="reviewExpl hidden">${escapeHtml(q.explanation)}</p>` : ''}
      `;
      const explBtn = item.querySelector('.explToggleBtn');
      if (explBtn){
        const explP = item.querySelector('.reviewExpl');
        explBtn.addEventListener('click', () => {
          const isHidden = explP.classList.toggle('hidden');
          explBtn.textContent = isHidden ? t('report.explanationShow') : t('report.explanationHide');
        });
      }
      list.appendChild(item);
    });
  }
  renderReviewList();

  flagToggle.addEventListener('click', () => {
    showFlaggedOnly = !showFlaggedOnly;
    flagToggle.textContent = showFlaggedOnly ? t('report.showAll') : t('report.flaggedOnly');
    renderReviewList();
  });

  document.getElementById('reportHomeBtn').addEventListener('click', () => showHome('objective'));
}

// Renders a compact score-trend list/sparkline under the report card.
function renderScoreTrend(container, history){
  container.innerHTML = `<h3 class="trendTitle">${t('report.trend')}</h3>`;
  if (!history || history.length === 0){
    container.innerHTML += `<p class="hint small">${t('report.trendEmpty')}</p>`;
    return;
  }
  const bars = document.createElement('div');
  bars.className = 'trendBars';
  const maxScore = 100;
  history.forEach((h, i) => {
    const bar = document.createElement('div');
    bar.className = 'trendBar';
    bar.title = `${t('report.trendAttempt', i + 1)}: ${h.score}%`;
    const fill = document.createElement('span');
    fill.style.height = Math.max(4, Math.round((h.score / maxScore) * 100)) + '%';
    bar.appendChild(fill);
    const label = document.createElement('label');
    label.textContent = h.score + '%';
    bar.appendChild(label);
    bars.appendChild(bar);
  });
  container.appendChild(bars);
}

// ---------- SUBJECTIVE ----------
const WORD_LIMITS = [125, 150, 200, 250];

async function generateSubjectiveTopic(topic){
  showLoading(t('loading.buildingSubjective', topic));
  try {
    const data = await callGenerate({ action: 'subjective-questions', topic });
    const questions = (data.questions || [])
      .filter(q => q && typeof q.question === 'string')
      .map(q => ({
        id: uid(),
        question: q.question,
        pyq: !!q.pyq,
        pyqSource: q.pyqSource || null,
        modelAnswers: {}, // keyed by word limit, e.g. { "150": "...", "250": "..." }
        annotations: {} // keyed by word limit, e.g. { "150": [{id,start,end,text,note,createdAt}] }
      }));
    if (questions.length === 0) throw new Error(t('err.noQuestions'));
    const entry = { id: uid(), topic, createdAt: Date.now(), questions, tags: [], lang: currentLang, cache: {} };
    const list = loadSubTopics();
    list.unshift(entry);
    saveSubTopics(list);
    showSubjectiveSet(entry.id);
  } catch (err){
    showError(err.message || t('err.generic'), () => generateSubjectiveTopic(topic));
  }
}

function persistModelAnswer(topicId, questionId, wordLimit, answer){
  const freshList = loadSubTopics();
  const freshEntry = freshList.find(t => t.id === topicId);
  if (!freshEntry) return;
  const freshQ = freshEntry.questions.find(x => x.id === questionId);
  if (!freshQ) return;
  if (!freshQ.modelAnswers) freshQ.modelAnswers = {};
  freshQ.modelAnswers[wordLimit] = answer;
  // A newly-fetched answer only exists in the entry's current language —
  // any cached translated version is now missing it, so drop the cache
  // rather than risk showing a stale/incomplete translation later.
  freshEntry.cache = {};
  // A freshly (re)fetched answer for this word limit invalidates any
  // highlights saved against the previous text at that length (offsets
  // would no longer line up), but leaves other lengths' highlights intact.
  if (freshQ.annotations) delete freshQ.annotations[wordLimit];
  saveSubTopics(freshList);
}

function persistAnnotations(topicId, questionId, wordLimit, annotations){
  const freshList = loadSubTopics();
  const freshEntry = freshList.find(t => t.id === topicId);
  if (!freshEntry) return;
  const freshQ = freshEntry.questions.find(x => x.id === questionId);
  if (!freshQ) return;
  if (!freshQ.annotations) freshQ.annotations = {};
  freshQ.annotations[wordLimit] = annotations;
  saveSubTopics(freshList);
}

// Renders the model answer text with saved highlight spans wrapped in
// <mark>, sorted and clipped so overlapping/out-of-range spans (e.g. from a
// stale save) never break the HTML structure.
function renderAnnotatedAnswer(container, text, annotations){
  container.innerHTML = '';
  const spans = (annotations || [])
    .filter(a => Number.isInteger(a.start) && Number.isInteger(a.end) && a.end > a.start && a.start >= 0 && a.end <= text.length)
    .sort((a, b) => a.start - b.start);

  let cursor = 0;
  spans.forEach(span => {
    if (span.start < cursor) return; // skip overlapping span
    if (span.start > cursor) container.appendChild(document.createTextNode(text.slice(cursor, span.start)));
    const mark = document.createElement('mark');
    mark.className = 'answerHighlight';
    mark.textContent = text.slice(span.start, span.end);
    mark.dataset.annId = span.id;
    if (span.note) mark.title = span.note;
    container.appendChild(mark);
    cursor = span.end;
  });
  if (cursor < text.length) container.appendChild(document.createTextNode(text.slice(cursor)));
}

function showSubjectiveSet(topicId){
  currentScreenRerender = () => showSubjectiveSet(topicId);
  openSubjectiveId = topicId;
  const list = loadSubTopics();
  const entry = list.find(t => t.id === topicId);
  if (!entry){ showHome('subjective'); return; }

  const n = clone('tpl-subjectiveset');
  render(n);
  closeMenu();
  document.getElementById('subjSetTitle').textContent = entry.topic;
  document.getElementById('subjHomeBtn').addEventListener('click', () => showHome('subjective'));

  const wrap = document.getElementById('subjQuestions');
  entry.questions.forEach((q, i) => {
    if (!q.modelAnswers) q.modelAnswers = {}; // back-compat for topics saved before this feature

    const card = document.createElement('div');
    card.className = 'subjQCard';

    const chipsHtml = WORD_LIMITS.map(wl =>
      `<button class="wlChip" data-wl="${wl}" aria-pressed="false">${t('subj.words', wl)}</button>`
    ).join('');

    card.innerHTML = `
      <div class="subjQHead"><span class="subjQNum">Q${i + 1}${q.pyq ? ' · ' + t('pyq.tag') + (q.pyqSource ? ' · ' + escapeHtml(q.pyqSource) : '') : ''}</span></div>
      <p class="subjQText">${escapeHtml(q.question)}</p>
      <p class="subjMeta">${t('subj.meta')}</p>
      <div class="wlRow">${chipsHtml}</div>
      <div class="modelAnswerWrap hidden">
        <p class="answerHint">${t('subj.annotateHint')}</p>
        <div class="modelAnswer"></div>
        <div class="noteEditor hidden">
          <textarea class="noteText" placeholder="${escapeHtml(t('subj.notePlaceholder'))}"></textarea>
          <div class="noteEditorBtns">
            <button type="button" class="ghostBtn noteSaveBtn">${t('subj.noteSave')}</button>
            <button type="button" class="ghostBtn noteCancelBtn">${t('subj.noteCancel')}</button>
          </div>
        </div>
        <div class="notesList"></div>
      </div>
    `;
    wrap.appendChild(card);

    const chips = Array.from(card.querySelectorAll('.wlChip'));
    const answerWrap = card.querySelector('.modelAnswerWrap');
    const answerBox = card.querySelector('.modelAnswer');
    const noteEditor = card.querySelector('.noteEditor');
    const noteText = card.querySelector('.noteText');
    const notesList = card.querySelector('.notesList');
    let activeWl = null;
    let pendingSelection = null; // { start, end } captured from a text selection, awaiting a note save/cancel

    if (!q.annotations) q.annotations = {}; // back-compat for topics saved before this feature

    function setActiveChip(wl){
      chips.forEach(c => {
        const isActive = Number(c.dataset.wl) === wl;
        c.classList.toggle('active', isActive);
        c.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
    }

    function currentAnnotations(){
      return q.annotations[activeWl] || [];
    }

    function renderNotesList(){
      const anns = currentAnnotations().filter(a => a.note);
      notesList.innerHTML = '';
      if (anns.length === 0) return;
      const title = document.createElement('p');
      title.className = 'notesListTitle';
      title.textContent = t('subj.notesTitle');
      notesList.appendChild(title);
      anns.forEach(a => {
        const item = document.createElement('div');
        item.className = 'noteItem';
        item.innerHTML = `<p class="noteItemQuote">"${escapeHtml(a.text)}"</p><p class="noteItemNote">${escapeHtml(a.note)}</p>`;
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'noteDelBtn';
        delBtn.textContent = t('subj.noteDelete');
        delBtn.addEventListener('click', () => removeAnnotation(a.id));
        item.appendChild(delBtn);
        notesList.appendChild(item);
      });
    }

    function refreshAnswerDisplay(){
      const text = q.modelAnswers[activeWl] || '';
      renderAnnotatedAnswer(answerBox, text, currentAnnotations());
      renderNotesList();
    }

    function removeAnnotation(annId){
      q.annotations[activeWl] = currentAnnotations().filter(a => a.id !== annId);
      persistAnnotations(topicId, q.id, activeWl, q.annotations[activeWl]);
      refreshAnswerDisplay();
    }

    function saveHighlight(note){
      if (!pendingSelection) return;
      const text = q.modelAnswers[activeWl] || '';
      const ann = {
        id: uid(),
        start: pendingSelection.start,
        end: pendingSelection.end,
        text: text.slice(pendingSelection.start, pendingSelection.end),
        note: note || '',
        createdAt: Date.now()
      };
      const updated = currentAnnotations().concat(ann);
      q.annotations[activeWl] = updated;
      persistAnnotations(topicId, q.id, activeWl, updated);
      pendingSelection = null;
      noteEditor.classList.add('hidden');
      noteText.value = '';
      refreshAnswerDisplay();
    }

    // Selecting text inside the rendered answer offers to turn it into a
    // highlight. Offsets are computed against the plain answer string
    // (not the DOM), since <mark> wrapping shifts DOM text-node boundaries.
    answerBox.addEventListener('mouseup', () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      if (!answerBox.contains(sel.anchorNode) || !answerBox.contains(sel.focusNode)) return;
      const text = q.modelAnswers[activeWl] || '';
      const range = sel.getRangeAt(0);
      const preRange = document.createRange();
      preRange.selectNodeContents(answerBox);
      preRange.setEnd(range.startContainer, range.startOffset);
      const start = preRange.toString().length;
      const selectedText = range.toString();
      const end = start + selectedText.length;
      sel.removeAllRanges();
      if (end <= start || !selectedText.trim()) return;
      pendingSelection = { start, end };
      noteText.value = '';
      noteEditor.classList.remove('hidden');
      noteText.focus();
    });

    card.querySelector('.noteSaveBtn').addEventListener('click', () => saveHighlight(noteText.value.trim()));
    card.querySelector('.noteCancelBtn').addEventListener('click', () => {
      pendingSelection = null;
      noteEditor.classList.add('hidden');
      noteText.value = '';
    });

    chips.forEach(chip => {
      chip.addEventListener('click', async () => {
        const wl = Number(chip.dataset.wl);

        // Clicking the already-open length again hides the answer.
        if (activeWl === wl && !answerWrap.classList.contains('hidden')){
          answerWrap.classList.add('hidden');
          noteEditor.classList.add('hidden');
          activeWl = null;
          setActiveChip(null);
          return;
        }

        const cached = q.modelAnswers[wl];
        if (cached){
          activeWl = wl;
          answerWrap.classList.remove('hidden');
          noteEditor.classList.add('hidden');
          refreshAnswerDisplay();
          setActiveChip(wl);
          return;
        }

        chips.forEach(c => c.disabled = true);
        chip.textContent = t('subj.writing');
        try {
          const data = await callGenerate({ action: 'subjective-answer', topic: entry.topic, question: q.question, wordLimit: wl });
          const answer = data.modelAnswer || t('subj.noAnswerFallback');
          q.modelAnswers[wl] = answer;
          persistModelAnswer(topicId, q.id, wl, answer);
          activeWl = wl;
          answerWrap.classList.remove('hidden');
          noteEditor.classList.add('hidden');
          refreshAnswerDisplay();
          setActiveChip(wl);
        } catch (err){
          alert(err.message || t('err.modelAnswer'));
        } finally {
          chips.forEach(c => c.disabled = false);
          chip.textContent = t('subj.words', wl);
        }
      });
    });
  });
}

// ---------- HAMBURGER MENU ----------
let menuSearchQuery = '';
let menuActiveTag = null; // null = all tags

function toggleTopicTag(list, saveFn, topicId, tag){
  const entry = list.find(x => x.id === topicId);
  if (!entry) return;
  if (!Array.isArray(entry.tags)) entry.tags = [];
  const idx = entry.tags.indexOf(tag);
  if (idx === -1) entry.tags.push(tag); else entry.tags.splice(idx, 1);
  saveFn(list);
}

function buildTagPicker(entry, list, saveFn){
  const wrap = document.createElement('div');
  wrap.className = 'tagPicker';
  const tags = Array.isArray(entry.tags) ? entry.tags : [];
  GS_TAGS.forEach(tag => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'tagChip' + (tags.includes(tag) ? ' active' : '');
    chip.textContent = tag;
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleTopicTag(list, saveFn, entry.id, tag);
      renderMenu();
    });
    wrap.appendChild(chip);
  });
  return wrap;
}

function buildMenuItem(entry, metaLabel, onOpen, list, saveFn){
  const row = document.createElement('div');
  row.className = 'menuItemRow';

  const btn = document.createElement('button');
  btn.className = 'menuItem';
  const tags = Array.isArray(entry.tags) ? entry.tags : [];
  const tagsHtml = tags.length ? `<span class="miTags">${tags.map(tg => `<span class="miTagBadge">${tg}</span>`).join('')}</span>` : '';
  btn.innerHTML = `<span class="miTopic">${escapeHtml(entry.topic)}</span><span class="miMeta">${metaLabel}${tagsHtml}</span>`;
  btn.addEventListener('click', onOpen);
  row.appendChild(btn);

  const tagBtn = document.createElement('button');
  tagBtn.type = 'button';
  tagBtn.className = 'miTagToggle';
  tagBtn.setAttribute('aria-label', t('tags.title'));
  tagBtn.textContent = '🏷';
  const picker = buildTagPicker(entry, list, saveFn);
  picker.classList.add('hidden');
  tagBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    picker.classList.toggle('hidden');
  });
  row.appendChild(tagBtn);
  row.appendChild(picker);
  return row;
}

function matchesSearch(entry, query){
  if (!query) return true;
  return entry.topic.toLowerCase().includes(query.toLowerCase());
}
function matchesTag(entry, tag){
  if (!tag) return true;
  return Array.isArray(entry.tags) && entry.tags.includes(tag);
}

function renderMenu(){
  const objTopics = loadObjTopics();
  const subTopics = loadSubTopics();

  const objList = document.getElementById('menuListObjective');
  const subList = document.getElementById('menuListSubjective');
  objList.innerHTML = '';
  subList.innerHTML = '';

  // Tag filter chips reflect the union of tags actually in use across both
  // saved lists, so the row doesn't show tags nothing has been given yet.
  const tagChipsWrap = document.getElementById('menuTagChips');
  if (tagChipsWrap){
    const inUse = new Set();
    objTopics.forEach(x => (x.tags || []).forEach(tg => inUse.add(tg)));
    subTopics.forEach(x => (x.tags || []).forEach(tg => inUse.add(tg)));
    tagChipsWrap.innerHTML = '';
    if (inUse.size > 0){
      const allChip = document.createElement('button');
      allChip.type = 'button';
      allChip.className = 'tagFilterChip' + (menuActiveTag === null ? ' active' : '');
      allChip.textContent = t('menu.tagAll');
      allChip.addEventListener('click', () => { menuActiveTag = null; renderMenu(); });
      tagChipsWrap.appendChild(allChip);
      GS_TAGS.filter(tg => inUse.has(tg)).forEach(tg => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'tagFilterChip' + (menuActiveTag === tg ? ' active' : '');
        chip.textContent = tg;
        chip.addEventListener('click', () => { menuActiveTag = (menuActiveTag === tg ? null : tg); renderMenu(); });
        tagChipsWrap.appendChild(chip);
      });
    }
  }

  const filteredObj = objTopics.filter(x => matchesSearch(x, menuSearchQuery) && matchesTag(x, menuActiveTag));
  const filteredSub = subTopics.filter(x => matchesSearch(x, menuSearchQuery) && matchesTag(x, menuActiveTag));

  if (objTopics.length === 0){
    objList.innerHTML = `<p class="menuEmpty">${t('menu.emptyObj')}</p>`;
  } else if (filteredObj.length === 0){
    objList.innerHTML = `<p class="menuEmpty">${t('menu.noMatches')}</p>`;
  } else {
    filteredObj.forEach(entry => {
      const scoreLabel = entry.lastResult ? t('menu.lastScore', entry.lastResult.score) : t('menu.notAttempted', entry.questions.length);
      const row = buildMenuItem(entry, scoreLabel, () => openObjectiveTopic(entry.id), objTopics, saveObjTopics);
      objList.appendChild(row);
    });
  }

  if (subTopics.length === 0){
    subList.innerHTML = `<p class="menuEmpty">${t('menu.emptySub')}</p>`;
  } else if (filteredSub.length === 0){
    subList.innerHTML = `<p class="menuEmpty">${t('menu.noMatches')}</p>`;
  } else {
    filteredSub.forEach(entry => {
      const row = buildMenuItem(entry, t('menu.questionCount', entry.questions.length), () => openSubjectiveTopic(entry.id), subTopics, saveSubTopics);
      subList.appendChild(row);
    });
  }

  const searchInput = document.getElementById('menuSearchInput');
  if (searchInput && searchInput.value !== menuSearchQuery) searchInput.value = menuSearchQuery;
}

function openMenu(){
  document.getElementById('sideMenu').classList.add('open');
  document.getElementById('menuOverlay').classList.remove('hidden');
  document.getElementById('menuBtn').setAttribute('aria-expanded', 'true');
  const status = document.getElementById('backupStatus');
  if (status){ status.classList.add('hidden'); status.textContent = ''; }
}
function closeMenu(){
  const sm = document.getElementById('sideMenu');
  const ov = document.getElementById('menuOverlay');
  if (sm) sm.classList.remove('open');
  if (ov) ov.classList.add('hidden');
  const mb = document.getElementById('menuBtn');
  if (mb) mb.setAttribute('aria-expanded', 'false');
}

// ---------- utils ----------
function escapeHtml(str){
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---------- Backup & Restore ----------
// A backup is a single JSON file containing everything the app stores in
// localStorage: both saved-topic lists plus the language preference. Export
// is a straight snapshot; import validates the file's shape before touching
// anything, then lets the user choose to merge it into (default, safe) or
// replace their currently saved topics.
const BACKUP_FORMAT = 'quebank-backup';
const BACKUP_VERSION = 1;

function buildBackupPayload(){
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      [LS_OBJ]: loadObjTopics(),
      [LS_SUB]: loadSubTopics(),
      [LS_LANG]: currentLang
    }
  };
}

function exportBackup(){
  const objTopics = loadObjTopics();
  const subTopics = loadSubTopics();
  if (objTopics.length === 0 && subTopics.length === 0){
    showBackupStatus(t('backup.exportedNothing'), false);
    return;
  }
  const payload = buildBackupPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = payload.exportedAt.slice(0, 10); // YYYY-MM-DD
  a.href = url;
  a.download = `quebank-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showBackupStatus(t('backup.exportDone'), false);
}

function showBackupStatus(message, isError){
  const el = document.getElementById('backupStatus');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
  el.classList.toggle('error', !!isError);
}

// Structural checks — reject anything that isn't shaped like a topic this
// app actually produces, rather than trusting an arbitrary file blindly.
function sanitizeObjTopic(x){
  if (!x || typeof x !== 'object') return null;
  if (typeof x.id !== 'string' || typeof x.topic !== 'string') return null;
  if (!Array.isArray(x.questions)) return null;
  const questions = x.questions.filter(q =>
    q && typeof q === 'object'
    && typeof q.id === 'string'
    && typeof q.question === 'string'
    && Array.isArray(q.options) && q.options.length === 4 && q.options.every(o => typeof o === 'string')
    && Number.isInteger(Number(q.correctIndex)) && Number(q.correctIndex) >= 0 && Number(q.correctIndex) <= 3
  );
  if (questions.length === 0) return null;
  return {
    id: x.id,
    topic: x.topic,
    createdAt: Number.isFinite(x.createdAt) ? x.createdAt : Date.now(),
    questions,
    // Defaults to however many questions actually made it through validation
    // above, so an older backup (from before batching existed, with no
    // totalPlanned field) is treated as already-complete rather than as a
    // stuck partial topic. A genuinely partial topic's backup correctly
    // carries its real totalPlanned (e.g. 30) forward instead.
    totalPlanned: Number.isInteger(x.totalPlanned) && x.totalPlanned >= questions.length ? x.totalPlanned : questions.length,
    lastResult: (x.lastResult && typeof x.lastResult === 'object') ? x.lastResult : null,
    history: Array.isArray(x.history) ? x.history.filter(h => h && typeof h === 'object' && Number.isFinite(h.score)) : [],
    flags: (x.flags && typeof x.flags === 'object') ? x.flags : {},
    tags: Array.isArray(x.tags) ? x.tags.filter(tg => GS_TAGS.includes(tg)) : [],
    lang: (x.lang === 'hi') ? 'hi' : 'en',
    cache: (x.cache && typeof x.cache === 'object') ? x.cache : {}
  };
}

function sanitizeSubTopic(x){
  if (!x || typeof x !== 'object') return null;
  if (typeof x.id !== 'string' || typeof x.topic !== 'string') return null;
  if (!Array.isArray(x.questions)) return null;
  const questions = x.questions.filter(q =>
    q && typeof q === 'object' && typeof q.id === 'string' && typeof q.question === 'string'
  ).map(q => ({
    id: q.id,
    question: q.question,
    pyq: !!q.pyq,
    pyqSource: q.pyqSource || null,
    modelAnswers: (q.modelAnswers && typeof q.modelAnswers === 'object') ? q.modelAnswers : {},
    annotations: (q.annotations && typeof q.annotations === 'object') ? q.annotations : {}
  }));
  if (questions.length === 0) return null;
  return {
    id: x.id,
    topic: x.topic,
    createdAt: Number.isFinite(x.createdAt) ? x.createdAt : Date.now(),
    questions,
    tags: Array.isArray(x.tags) ? x.tags.filter(tg => GS_TAGS.includes(tg)) : [],
    lang: (x.lang === 'hi') ? 'hi' : 'en',
    cache: (x.cache && typeof x.cache === 'object') ? x.cache : {}
  };
}

function parseBackupFile(rawText){
  let obj;
  try { obj = JSON.parse(rawText); }
  catch (e){ return null; }
  if (!obj || typeof obj !== 'object' || obj.format !== BACKUP_FORMAT || !obj.data || typeof obj.data !== 'object'){
    return null;
  }
  const rawObj = Array.isArray(obj.data[LS_OBJ]) ? obj.data[LS_OBJ] : [];
  const rawSub = Array.isArray(obj.data[LS_SUB]) ? obj.data[LS_SUB] : [];
  const objTopics = rawObj.map(sanitizeObjTopic).filter(Boolean);
  const subTopics = rawSub.map(sanitizeSubTopic).filter(Boolean);
  const lang = (obj.data[LS_LANG] === 'hi') ? 'hi' : 'en';
  return {
    objTopics, subTopics, lang,
    skippedObj: rawObj.length - objTopics.length,
    skippedSub: rawSub.length - subTopics.length
  };
}

function applyBackupMerge(parsedBackup){
  const currentObj = loadObjTopics();
  const currentSub = loadSubTopics();
  const currentObjIds = new Set(currentObj.map(x => x.id));
  const currentSubIds = new Set(currentSub.map(x => x.id));

  const newObj = parsedBackup.objTopics.filter(x => !currentObjIds.has(x.id));
  const newSub = parsedBackup.subTopics.filter(x => !currentSubIds.has(x.id));

  saveObjTopics([...currentObj, ...newObj]);
  saveSubTopics([...currentSub, ...newSub]);

  const skippedObj = parsedBackup.skippedObj + (parsedBackup.objTopics.length - newObj.length);
  const skippedSub = parsedBackup.skippedSub + (parsedBackup.subTopics.length - newSub.length);
  return { addedObj: newObj.length, addedSub: newSub.length, skippedObj, skippedSub };
}

function applyBackupReplace(parsedBackup){
  saveObjTopics(parsedBackup.objTopics);
  saveSubTopics(parsedBackup.subTopics);
  // Replace means "make my state match this backup exactly" — that includes
  // the language preference it was exported with, not just the topic lists.
  if (parsedBackup.lang && parsedBackup.lang !== currentLang){
    currentLang = parsedBackup.lang;
    localStorage.setItem(LS_LANG, currentLang);
    document.documentElement.lang = currentLang;
    updateLangButtons();
    applyI18n(document);
  }
}

function importBackupFile(file){
  const reader = new FileReader();
  reader.onerror = () => showBackupStatus(t('backup.readError'), true);
  reader.onload = () => {
    const parsed = parseBackupFile(String(reader.result || ''));
    if (!parsed){
      showBackupStatus(t('backup.invalidFile'), true);
      return;
    }
    if (parsed.objTopics.length === 0 && parsed.subTopics.length === 0){
      showBackupStatus(t('backup.invalidFile'), true);
      return;
    }
    // Native confirm keeps this consistent with the app's existing use of
    // alert() for model-answer errors — no extra modal system needed for
    // a rarely-used, explicit destructive-vs-safe choice like this one.
    const wantsMerge = window.confirm(t('backup.confirmReplace', parsed.objTopics.length, parsed.subTopics.length));
    if (wantsMerge){
      const result = applyBackupMerge(parsed);
      showBackupStatus(t('backup.mergeSummary', result.addedObj, result.addedSub, result.skippedObj, result.skippedSub), false);
    } else {
      applyBackupReplace(parsed);
      showBackupStatus(t('backup.replaceSummary', parsed.objTopics.length, parsed.subTopics.length), false);
    }
    renderMenu();
  };
  reader.readAsText(file);
}

// ---------- global chrome wiring ----------
document.getElementById('menuBtn').addEventListener('click', openMenu);
document.getElementById('menuCloseBtn').addEventListener('click', closeMenu);
document.getElementById('menuOverlay').addEventListener('click', closeMenu);
document.getElementById('homeBtn').addEventListener('click', () => showHome());
document.querySelectorAll('.menuTab').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.menuTab').forEach(x => x.classList.toggle('active', x === t));
    document.getElementById('menuListObjective').classList.toggle('hidden', t.dataset.menutab !== 'objective');
    document.getElementById('menuListSubjective').classList.toggle('hidden', t.dataset.menutab !== 'subjective');
  });
});
document.querySelectorAll('.langBtn').forEach(btn => {
  btn.addEventListener('click', () => setLang(btn.dataset.lang));
});
document.getElementById('menuSearchInput').addEventListener('input', (e) => {
  menuSearchQuery = e.target.value;
  renderMenu();
});
document.getElementById('exportBackupBtn').addEventListener('click', exportBackup);
document.getElementById('importBackupBtn').addEventListener('click', () => {
  document.getElementById('importFileInput').click();
});
document.getElementById('importFileInput').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (file) importBackupFile(file);
  e.target.value = ''; // allow re-importing the same filename later
});

// ---------- service worker ----------
if ('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// ---------- boot ----------
document.documentElement.lang = currentLang;
updateLangButtons();
applyI18n(document);
showHome('objective');
