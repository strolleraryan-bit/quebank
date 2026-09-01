// netlify/functions/generate.js
// Server-side proxy to the Gemini API. The API key lives only in the
// Netlify environment variable GEMINI_API_KEY — never sent to the client.
//
// Expects POST body: { action: 'objective' | 'subjective-questions' | 'subjective-answer' | 'translate', topic, question?, wordLimit?, lang?, count?, excludeQuestions? }
// lang: 'en' (default) or 'hi' — which language the generated content itself should be written in.
// count (action: 'objective' only): how many MCQs to generate in this call, 1-30, default 30.
//   The client normally requests 5 at a time (see app.js OBJ_BATCH_SIZE) since a
//   single 30-question call is slow/unreliable on Gemini's free tier; the full
//   30-question topic is assembled client-side across several of these calls.
// excludeQuestions (action: 'objective' only): array of question text already
//   generated for this same topic in earlier batches, so a later batch doesn't
//   repeat one. Also de-duped defensively on the client in case Gemini still
//   echoes one back despite this list.
//
// Reliability notes (see README section 6 / this file's history):
// - Every Gemini call uses a strict responseSchema so the model is constrained
//   to valid, well-shaped JSON at generation time (far fewer parse failures
//   than relying on prompt instructions alone).
// - Every Gemini call is retried automatically on transient failure (network
//   error, timeout, 5xx, or a response that fails our own structural
//   validation) using a short backoff, bounded so the whole handler still
//   finishes comfortably inside Netlify's synchronous function time limit.
// - A per-attempt AbortController timeout ensures a stuck upstream call
//   fails fast enough to retry, rather than hanging until Netlify kills the
//   function outright.

const MODEL = 'gemini-flash-latest'; // alias that tracks Google's current default Flash model
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const MAX_ATTEMPTS = 3;
const ATTEMPT_TIMEOUT_MS = 9000;   // per-attempt hard timeout
const BACKOFF_BASE_MS = 400;       // backoff grows: 400ms, 800ms, ...

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST'){
    return respond(405, { error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey){
    return respond(500, { error: 'Server is missing GEMINI_API_KEY. Set it in Netlify → Site configuration → Environment variables.' });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return respond(400, { error: 'Invalid request body.' }); }

  const { action, topic, question, wordLimit, lang, texts, count, excludeQuestions } = body;
  const language = lang === 'hi' ? 'hi' : 'en';

  const ALLOWED_WORD_LIMITS = [125, 150, 200, 250];
  const DEFAULT_OBJECTIVE_COUNT = 30;
  const MAX_OBJECTIVE_COUNT = 30; // hard ceiling regardless of what the client sends

  let prompt, schema, maxOutputTokens, validate;

  if (action === 'translate'){
    // Used to re-render an already-saved topic (or its cached model answers)
    // in a different language than it was originally generated in — e.g.
    // opening an English-generated topic while the UI is set to Hindi.
    if (!Array.isArray(texts) || texts.length === 0){
      return respond(400, { error: 'A non-empty texts array is required for translation.' });
    }
    if (texts.some(x => typeof x !== 'string')){
      return respond(400, { error: 'All items in texts must be strings.' });
    }
    prompt = buildTranslatePrompt(texts, language);
    schema = translateSchema();
    maxOutputTokens = 8192;
    validate = (parsed) => Array.isArray(parsed?.texts) && parsed.texts.length === texts.length && parsed.texts.every(x => typeof x === 'string');
  } else if (!topic || typeof topic !== 'string'){
    return respond(400, { error: 'A topic is required.' });
  } else if (action === 'objective'){
    // Objective sets are generated in batches (default: all 30 in one call;
    // the client now normally asks for 5 at a time, since free-tier Gemini
    // is slow/unreliable with a single 30-question call). excludeQuestions
    // carries the question text of everything already generated for this
    // topic so far, so a later batch doesn't repeat an earlier one.
    const requestedCount = Number.isInteger(Number(count)) ? Number(count) : DEFAULT_OBJECTIVE_COUNT;
    const objCount = Math.max(1, Math.min(MAX_OBJECTIVE_COUNT, requestedCount));
    const priorQuestions = Array.isArray(excludeQuestions) ? excludeQuestions.filter(x => typeof x === 'string' && x.trim()) : [];
    prompt = buildObjectivePrompt(topic, language, objCount, priorQuestions);
    schema = objectiveSchema();
    maxOutputTokens = objCount <= 5 ? 3072 : 8192;
    // Accept partial credit — at least 2/3 of what was asked for (but never
    // more than what was asked), same spirit as the original ">=20 of 30".
    const minValid = Math.max(1, Math.ceil(objCount * 0.67));
    validate = (parsed) => Array.isArray(parsed?.questions) && parsed.questions.length >= minValid && parsed.questions.every(isValidObjectiveQuestion);
  } else if (action === 'subjective-questions'){
    prompt = buildSubjectiveQuestionsPrompt(topic, language);
    schema = subjectiveQuestionsSchema();
    maxOutputTokens = 3072;
    validate = (parsed) => Array.isArray(parsed?.questions) && parsed.questions.length >= 3 && parsed.questions.every(isValidSubjectiveQuestion);
  } else if (action === 'subjective-answer'){
    if (!question || typeof question !== 'string'){
      return respond(400, { error: 'A question is required to generate its model answer.' });
    }
    const wl = ALLOWED_WORD_LIMITS.includes(Number(wordLimit)) ? Number(wordLimit) : 150;
    prompt = buildSubjectiveAnswerPrompt(topic, question, wl, language);
    schema = subjectiveAnswerSchema();
    maxOutputTokens = 2048;
    validate = (parsed) => typeof parsed?.modelAnswer === 'string' && parsed.modelAnswer.trim().length > 0;
  } else {
    return respond(400, { error: 'Unknown action.' });
  }


  try {
    const parsed = await generateWithRetry({ apiKey, prompt, schema, maxOutputTokens, validate });
    return respond(200, parsed);
  } catch (err){
    console.error('generate function failure', err && err.message, err && err.attempts);
    if (err && err.userMessage){
      return respond(err.statusCode || 502, { error: err.userMessage });
    }
    return respond(500, { error: 'Unexpected server error while generating content. Please try again.' });
  }
};

// ---------- Core Gemini call with retry/backoff/timeout/validation ----------

// Upper bound on how long we'll sleep even if Gemini's Retry-After asks for
// more — a long quota-reset wait (sometimes 20-30s+) is better handled by
// failing this attempt and letting the client's own retry / manual "Retry"
// button try again later, rather than holding one Netlify invocation open
// and risking it getting killed by the platform's function time limit.
const MAX_RESPECTED_RETRY_AFTER_MS = 4000;

async function generateWithRetry({ apiKey, prompt, schema, maxOutputTokens, validate }){
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++){
    try {
      const parsed = await callGeminiOnce({ apiKey, prompt, schema, maxOutputTokens });

      if (!validate(parsed)){
        // Explicitly retryable: an incomplete/malformed structured response
        // from Gemini is exactly the transient failure mode this retry loop
        // exists to recover from (see makeError's default retryable=true).
        throw makeError('The generator returned an incomplete response.', 502);
      }

      return parsed; // success
    } catch (err){
      lastError = err;
      const isLastAttempt = attempt === MAX_ATTEMPTS;
      const retryable = err.retryable !== false; // default true unless explicitly marked non-retryable

      if (!retryable || isLastAttempt){
        break;
      }

      // Prefer Gemini's own Retry-After (429 rate limit / 503 overloaded)
      // over our generic backoff when it gave us one — it knows its own
      // quota window better than a fixed guess does. Still capped so a
      // long quota-reset wait can't stall the whole function.
      const waitMs = Number.isFinite(err.retryAfterMs)
        ? Math.min(err.retryAfterMs, MAX_RESPECTED_RETRY_AFTER_MS)
        : BACKOFF_BASE_MS * attempt;
      await sleep(waitMs);
    }
  }

  // All attempts exhausted (or a non-retryable error occurred).
  const quotaExhausted = lastError && lastError.statusCode === 429;
  const finalErr = makeError(
    lastError && lastError.userMessage
      ? lastError.userMessage
      : quotaExhausted
        ? 'Gemini rate limit reached. Wait a bit before generating again, or check your API quota/billing.'
        : 'The generator is having trouble responding right now. Please try again in a moment.',
    lastError && lastError.statusCode ? lastError.statusCode : 502
  );
  finalErr.attempts = MAX_ATTEMPTS;
  throw finalErr;
}

async function callGeminiOnce({ apiKey, prompt, schema, maxOutputTokens }){
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);

  let geminiRes;
  try {
    geminiRes = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: schema,
          temperature: 0.9,
          maxOutputTokens
        }
      })
    });
  } catch (err){
    if (err.name === 'AbortError'){
      throw makeError('The generator took too long to respond.', 504);
    }
    throw makeError('Could not reach the generator. Check your connection and try again.', 502);
  } finally {
    clearTimeout(timeout);
  }

  if (!geminiRes.ok){
    const errText = await safeText(geminiRes);
    console.error('Gemini API error', geminiRes.status, errText);

    // 4xx (other than 429) usually means a bad request/key — not worth retrying.
    const nonRetryable = geminiRes.status >= 400 && geminiRes.status < 500 && geminiRes.status !== 429;
    const err = makeError(
      geminiRes.status === 429
        ? `Gemini API rate limit reached (429). Retrying…`
        : nonRetryable
          ? `Gemini API rejected the request (${geminiRes.status}). Check your API key and quota.`
          : `Gemini API returned an error (${geminiRes.status}). Retrying…`,
      geminiRes.status === 429 ? 429 : 502
    );
    err.retryable = !nonRetryable;
    // 429 (rate limit) and 503 (overloaded) commonly come with a Retry-After
    // header telling us exactly how long to back off — respect it instead of
    // our generic fixed backoff when present (see MAX_RESPECTED_RETRY_AFTER_MS
    // in generateWithRetry for the cap).
    const retryAfterHeader = geminiRes.headers && geminiRes.headers.get && geminiRes.headers.get('retry-after');
    if (retryAfterHeader){
      const asSeconds = Number(retryAfterHeader);
      if (Number.isFinite(asSeconds)) err.retryAfterMs = asSeconds * 1000;
    }
    throw err;
  }

  const data = await geminiRes.json();

  // A response can come back 200 OK but with no candidate (e.g. blocked by
  // safety filters) — treat that as a retryable failure with a clear message.
  const candidate = data?.candidates?.[0];
  if (!candidate){
    throw makeError('The generator did not return any content. Please try again.', 502);
  }
  const finishReason = candidate.finishReason;
  const raw = candidate?.content?.parts?.map(p => p.text || '').join('') || '';

  if (!raw.trim()){
    throw makeError('The generator returned an empty response. Please try again.', 502);
  }

  const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e){
    console.error('Could not parse Gemini JSON', finishReason, cleaned.slice(0, 500));
    // MAX_TOKENS mid-JSON is a common cause of truncated/unparsable output —
    // still retryable, just means we should try again (schema + token budget
    // above are tuned to make this rare).
    throw makeError('The generator returned an unexpected format. Please try again.', 502);
  }

  return parsed;
}

function makeError(userMessage, statusCode, retryable = true){
  const err = new Error(userMessage);
  err.userMessage = userMessage;
  err.statusCode = statusCode;
  err.retryable = retryable;
  return err;
}

function sleep(ms){ return new Promise(resolve => setTimeout(resolve, ms)); }

async function safeText(res){
  try { return await res.text(); } catch (e){ return '(no body)'; }
}

function respond(statusCode, obj){
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj)
  };
}

// ---------- Structural validators ----------

function isValidObjectiveQuestion(q){
  return q
    && typeof q.question === 'string' && q.question.trim().length > 0
    && Array.isArray(q.options) && q.options.length === 4 && q.options.every(o => typeof o === 'string' && o.trim().length > 0)
    && Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex <= 3
    && typeof q.explanation === 'string'
    && typeof q.pyq === 'boolean';
}

function isValidSubjectiveQuestion(q){
  return q
    && typeof q.question === 'string' && q.question.trim().length > 0
    && typeof q.pyq === 'boolean';
}

// ---------- Gemini responseSchema builders ----------
// Constraining the shape at generation time (not just via prompt instructions)
// is what actually cuts down malformed/truncated JSON in practice.

function objectiveSchema(){
  return {
    type: 'OBJECT',
    properties: {
      questions: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            question: { type: 'STRING' },
            options: { type: 'ARRAY', items: { type: 'STRING' } },
            correctIndex: { type: 'INTEGER' },
            explanation: { type: 'STRING' },
            pyq: { type: 'BOOLEAN' },
            pyqSource: { type: 'STRING', nullable: true }
          },
          required: ['question', 'options', 'correctIndex', 'explanation', 'pyq']
        }
      }
    },
    required: ['questions']
  };
}

function subjectiveQuestionsSchema(){
  return {
    type: 'OBJECT',
    properties: {
      questions: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            question: { type: 'STRING' },
            pyq: { type: 'BOOLEAN' },
            pyqSource: { type: 'STRING', nullable: true }
          },
          required: ['question', 'pyq']
        }
      }
    },
    required: ['questions']
  };
}

function subjectiveAnswerSchema(){
  return {
    type: 'OBJECT',
    properties: {
      modelAnswer: { type: 'STRING' }
    },
    required: ['modelAnswer']
  };
}

function translateSchema(){
  return {
    type: 'OBJECT',
    properties: {
      texts: { type: 'ARRAY', items: { type: 'STRING' } }
    },
    required: ['texts']
  };
}

// ---------- Prompts ----------
// Appended to every prompt so Gemini knows which language the actual content
// (questions, options, explanations, model answers) should be written in.
// pyqSource exam/year labels (e.g. "UPSC CSE 2019") stay in their usual short
// form either way — that's not prose content, just a citation tag.
function languageInstruction(language){
  if (language === 'hi'){
    return `\n- Write ALL content — questions, options, explanations, everything — in Hindi (Devanagari script), in the same register used in Hindi-medium UPSC/UPPCS material. Keep proper nouns, Article/Section numbers, Acts, and English abbreviations (e.g. "अनुच्छेद 32", "GST", "UPSC") in their standard commonly-used form rather than forcing an awkward translation. The "pyqSource" value (exam name + year) may stay in its usual short form, e.g. "UPSC CSE 2019".`;
  }
  return `\n- Write all content in English.`;
}

function buildObjectivePrompt(topic, language, count, excludeQuestions){
  const exclusionBlock = (excludeQuestions && excludeQuestions.length)
    ? `\n\nThe following ${excludeQuestions.length} question(s) have ALREADY been generated for this same topic in earlier batches — do NOT repeat any of them, and do not generate close rephrasings of them either:\n${excludeQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`
    : '';
  return `You are an expert question setter for India's UPSC Civil Services Examination (Prelims) and UPPCS (Uttar Pradesh PCS) Prelims.

Generate exactly ${count} multiple-choice questions on the topic: "${topic}".

Requirements:
- Match the difficulty, phrasing style, and conceptual depth of actual UPSC Prelims / UPPCS Prelims questions (statement-based, assertion-reason, matching-type, and direct factual questions — vary the format).
- Include roughly 1 in 5 questions that are exact or closely adapted Previous Year Questions (PYQs) from UPSC CSE Prelims or UPPCS Prelims — at least 1 if ${count} is small. Mark these with "pyq": true and name the exam and year in "pyqSource" (e.g. "UPSC CSE 2019", "UPPCS 2021"). For non-PYQ questions, omit "pyqSource" or leave it null.
- Every question must have exactly 4 options, plausible distractors, and exactly one correct option.
- "correctIndex" is the zero-based index (0-3) of the correct option.
- "explanation" is a concise 1-3 sentence explanation of why the correct option is right.
- Do not repeat the same question twice within this response.${exclusionBlock}${languageInstruction(language)}
- The "questions" array must contain exactly ${count} items.`;
}

function buildSubjectiveQuestionsPrompt(topic, language){
  return `You are an expert question setter for India's UPSC Civil Services Examination (Mains) and UPPCS Mains.

Generate exactly 5 subjective/descriptive questions on the topic: "${topic}".

Requirements:
- Match the analytical, essay-style phrasing of actual UPSC Mains / UPPCS Mains questions (e.g. "Discuss...", "Critically examine...", "To what extent...").
- Include at least 1 question that is an exact or closely adapted Mains PYQ. Mark it with "pyq": true and name the exam and year in "pyqSource". For non-PYQ questions, omit "pyqSource" or leave it null.
- Do NOT include model answers or word limits in this response — those are handled separately.${languageInstruction(language)}
- The "questions" array must contain exactly 5 items.`;
}

function buildTranslatePrompt(texts, language){
  const targetName = language === 'hi' ? 'Hindi (Devanagari script)' : 'English';
  const register = language === 'hi'
    ? 'the register used in Hindi-medium UPSC/UPPCS material'
    : 'the register used in standard UPSC/UPPCS English material';
  return `Translate each string in the following JSON array into ${targetName}, in ${register}. These strings are questions, options, explanations, or model answers from a UPSC/UPPCS question bank.

Requirements:
- Return exactly ${texts.length} elements, in the same order as the input — one translation per input element.
- Keep proper nouns, Article/Section numbers, Acts, and standard English abbreviations (e.g. "अनुच्छेद 32", "GST", "UPSC") in their normal commonly-used form rather than forcing an awkward translation.
- If an input element is an empty string, return an empty string for it unchanged.
- Do not merge, split, add, remove, or reorder elements.

Input array (${texts.length} elements):
${JSON.stringify(texts)}`;
}

function buildSubjectiveAnswerPrompt(topic, question, wordLimit, language){
  return `You are a UPSC Civil Services Mains topper known for writing some of the highest-scoring answers in the exam.

Write a model answer for this Mains-style question on the topic "${topic}":
"${question}"

Requirements:
- Target length: as close to ${wordLimit} words as possible (do not exceed it by more than ~15%). Do not pad to reach the length — every sentence should carry marks-worthy content.
- Follow the standard UPSC Mains answer pattern:
  - Introduction: 1-2 crisp sentences that set context — a definition, a fact, a constitutional reference, or a brief framing of the issue, whichever fits this question best.
  - Body: organised into clear dimensions relevant to this specific topic (for example: constitutional/legal, political, economic, social, administrative, environmental, or international — use only the dimensions that genuinely apply, not all of them). Use short paragraphs and, where they aid clarity, bullet points.
  - Conclusion: a brief, balanced way-forward or forward-looking statement — not a repeat of the introduction.
- Write like a topper: include real, relevant examples, case studies, committee/commission references, constitutional articles, landmark judgments, or government schemes wherever they genuinely strengthen the answer for THIS topic. Never force an example, case study, or named reference that doesn't fit — omit it rather than pad with something generic or invented.
- Where it suits the question, apply an appropriate analytical approach (e.g. cause-effect analysis, SWOT, stakeholder/multi-dimensional analysis, comparative analysis, a diagram-in-words like a simple flow) — choose whichever genuinely fits this topic, and skip it entirely if none fits naturally.
- Be factually careful and balanced across viewpoints; do not fabricate statistics, case names, or judgments — if unsure of a specific fact, keep the point conceptual instead of inventing a citation.${languageInstruction(language)}`;
}
