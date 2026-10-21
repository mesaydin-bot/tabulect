import type { BookmarkSpan, Chunk } from "../types/document";
import type { SourceUnit } from "./selection";
import { firstSentenceEnd, readingParagraphs } from "./reading.ts";

export type FineMode = "word" | "grammar" | "phrase";
export type AutoAxis = "horizontal" | "vertical";
export type WordStep = 1 | 2 | 3 | 4 | 5;
export type TextRange = { start: number; end: number };
export type Passage = SourceUnit & { key: string };
export type FineUnit = SourceUnit & { passageKey: string; pending?: boolean; provisional?: boolean };

const PURE_DETERMINERS = new Set([
  "the", "a", "an", "my", "your", "his", "its", "our", "their", "every", "each", "another",
  "no", "some", "any", "either", "neither",
  "bir", "her", "bazı", "birkaç", "birçok", "tüm", "bütün", "hiçbir", "kendi", "kimi",
]);

const DEMONSTRATIVES = new Set(["this", "that", "these", "those", "such", "bu", "şu"]);

const DEGREE_ADVERBS = new Set([
  "very", "quite", "rather", "too", "so", "more", "most", "less", "least", "almost", "nearly",
  "fairly", "pretty", "really", "extremely", "surprisingly", "remarkably", "particularly",
  "especially", "entirely", "completely", "highly", "deeply", "truly", "fully", "widely", "closely",
  "oldukça", "çok", "pek", "en", "daha", "fazla", "gayet", "epey", "birhayli", "tamamen", "kesinlikle",
]);

const VERB_ADVERBS = new Set([
  "not", "never", "ever", "always", "already", "just", "still", "even", "only", "also", "often",
  "seldom", "rarely", "soon",
  "hiç", "asla", "hep", "zaten", "henüz", "hala", "hâlâ", "sadece", "yalnızca", "bile", "daima", "hemen", "artık",
]);

const AUXILIARIES = new Set([
  "am", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "having",
  "do", "does", "did",
  "will", "would", "shall", "should", "can", "could", "may", "might", "must", "ought",
]);

const NOMINATIVE_PRONOUNS = new Set([
  "i", "he", "she", "we", "they", "you",
  "ben", "sen", "biz", "siz", "onlar",
]);

const OBJECT_PRONOUNS = new Set([
  "me", "him", "us", "them", "myself", "yourself", "himself", "herself", "itself", "ourselves", "themselves",
  "beni", "seni", "onu", "bizi", "sizi", "onları", "bana", "sana", "ona", "bize", "size", "onlara",
  "bende", "sende", "onda", "bizde", "sizde", "onlarda", "benden", "senden", "ondan", "bizden", "sizden", "onlardan",
]);

const SUBORDINATORS_AND_RELATIVES = new Set([
  "who", "whom", "whose", "which", "where", "when", "why", "while", "whilst", "whereas",
  "although", "though", "because", "since", "unless", "until", "till", "if", "whether",
  "once", "whenever", "wherever",
  "ancak", "ama", "fakat", "lakin", "çünkü", "zira", "oysa", "halbuki", "madem", "mademki", "eğer", "şayet", "üstelik", "ayrıca",
]);

const COORDINATORS = new Set(["and", "but", "or", "nor", "yet", "ve", "veya", "ya", "yahut"]);

const PREPOSITIONS = new Set([
  "in", "on", "at", "by", "for", "with", "about", "against", "between", "into", "through",
  "during", "before", "after", "above", "below", "from", "without", "within", "along", "across",
  "behind", "beyond", "towards", "toward", "upon", "among", "amongst", "around", "near",
  "despite", "throughout", "over", "under", "beside", "besides", "except", "regarding", "concerning", "via", "per",
]);

const PHRASAL_PARTICLES = new Set([
  "up", "out", "down", "off", "away", "back", "over", "along", "around", "through", "together", "apart", "forward", "ahead", "aside",
]);

const INFINITIVE_VERBS = new Set([
  "taken", "take", "took", "takes", "decided", "decide", "decides", "want", "wanted", "wants",
  "try", "tried", "tries", "trying", "need", "needed", "needs", "used", "going",
  "seem", "seemed", "seems", "appear", "appeared", "appears", "tend", "tended", "tends",
  "fail", "failed", "fails", "learn", "learned", "learns", "hope", "hoped", "hopes",
  "agree", "agreed", "agrees", "refuse", "refused", "refuses", "manage", "managed", "manages",
  "begin", "began", "begins", "start", "started", "starts", "continue", "continued", "continues",
  "expect", "expected", "expects", "mean", "meant", "means", "wish", "wished", "wishes",
  "plan", "planned", "plans", "offer", "offered", "offers", "promise", "promised", "promises",
  "choose", "chose", "chosen", "have", "has", "had", "ought", "able", "supposed", "allowed",
  "known", "thought", "said", "believed", "considered", "found",
]);

const TURKISH_POSTPOSITIONS = new Set([
  "için", "göre", "kadar", "gibi", "doğru", "karşı", "rağmen", "karşın", "dolayı", "ötürü",
  "beri", "önce", "sonra", "birlikte", "beraber", "üzere", "dair", "ilişkin", "yönelik",
  "sayesinde", "nedeniyle", "yüzünden", "açısından", "bakımından", "tarafından", "boyunca",
  "arasında", "üzerinde", "üzerine", "altında", "içinde", "dışında", "yanında", "karşısında", "hakkında", "konusunda",
]);

const COMMON_ADJECTIVES = new Set([
  "good", "bad", "new", "old", "big", "small", "large", "largest", "larger", "great", "greatest", "greater",
  "high", "higher", "highest", "low", "lower", "lowest", "long", "longer", "longest", "short", "shorter", "shortest",
  "next", "last", "first", "second", "third", "other", "another", "same", "simple", "simpler", "simplest",
  "difficult", "careful", "useful", "main", "major", "minor", "whole", "clear", "full", "free", "real", "true",
  "right", "wrong", "hard", "easy", "early", "late", "important", "different", "possible", "available",
  "necessary", "natural", "meaningful", "human", "social", "political", "economic", "public", "local",
  "national", "general", "specific", "certain", "particular", "single", "common", "similar", "various",
  "several", "few", "many", "much", "little", "own",
  "büyük", "küçük", "yeni", "eski", "iyi", "kötü", "uzun", "kısa", "önemli", "farklı", "anlamlı", "doğal",
  "temel", "genel", "özel", "ortak", "benzer", "çeşitli", "doğru", "yanlış", "güzel", "zor", "kolay", "dikkatli", "yararlı", "basit", "karmaşık",
]);

const FINITE_VERBS = new Set([
  "requires", "require", "required", "gave", "give", "gives", "given", "took", "take", "takes", "taken",
  "made", "make", "makes", "came", "come", "comes", "went", "go", "goes", "knew", "know", "knows", "known",
  "saw", "see", "sees", "seen", "thought", "think", "thinks", "found", "find", "finds", "told", "tell", "tells",
  "became", "become", "becomes", "left", "leave", "leaves", "felt", "feel", "feels", "put", "puts",
  "brought", "bring", "brings", "began", "begin", "begins", "kept", "keep", "keeps", "held", "hold", "holds",
  "wrote", "write", "writes", "stood", "stand", "stands", "heard", "hear", "hears", "let", "lets",
  "meant", "mean", "means", "set", "sets", "met", "meet", "meets", "ran", "run", "runs", "paid", "pay", "pays",
  "sat", "sit", "sits", "spoke", "speak", "speaks", "led", "lead", "leads", "read", "reads", "grew", "grow", "grows",
  "lost", "lose", "loses", "fell", "fall", "falls", "sent", "send", "sends", "built", "build", "builds",
  "understood", "understand", "understands", "spent", "spend", "spends", "cut", "cuts", "rose", "rise", "rises",
  "bought", "buy", "buys", "chose", "choose", "chooses", "decided", "decide", "decides",
  "lives", "live", "lived", "works", "work", "worked", "seems", "seem", "seemed", "appears", "appear", "appeared",
  "remains", "remain", "remained", "provides", "provide", "provided", "allows", "allow", "allowed",
  "includes", "include", "included", "continues", "continue", "continued", "contains", "contain", "contained",
  "shows", "show", "showed", "creates", "create", "created", "causes", "cause", "caused", "helps", "help", "helped",
  "needs", "need", "needed", "wants", "want", "wanted", "uses", "use", "used", "follows", "follow", "followed",
  "offers", "offer", "offered", "reaches", "reach", "reached", "serves", "serve", "served",
  "produces", "produce", "produced", "expects", "expect", "expected", "suggests", "suggest", "suggested",
]);

const ABBREV_RE = /^(?:mr|mrs|ms|dr|prof|sr|jr|vs|etc|fig|no|vol|pp|ch|st|ave|inc|ltd|co|corp|vb|örn|bkz|krş|yy|hz|av|doç|yard|uzm)\b\.$/iu;
const WORD_TOKEN_RE = /[\p{L}\p{M}\p{N}]+(?:['’\-][\p{L}\p{M}\p{N}]+)*/gu;

export function normalizeWordStep(raw: unknown): WordStep {
  const n = Number(raw);
  if (n === 2 || n === 3 || n === 4 || n === 5) return n;
  return 1;
}

export function normalizeWpm(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 240;
  return Math.max(60, Math.min(900, Math.round(n / 10) * 10));
}

export function countWords(text: string): number {
  const matches = [...String(text || "").matchAll(WORD_TOKEN_RE)];
  return Math.max(1, matches.length);
}

/** Compute natural reading dwell time (ms) for a highlighted unit at the given WPM. */
export function stepDelayMs(text: string, wpm: number, minWords = 1): number {
  const safeWpm = Math.max(60, Math.min(900, Number(wpm) || 240));
  const msPerWord = 60_000 / safeWpm;
  const words = Math.max(minWords, countWords(text));
  const trimmed = String(text || "").trimEnd();
  const punctFactor = /[.!?…][)\]"”’»]*$/u.test(trimmed)
    ? 0.35
    : /[,;:—–][)\]"”’»]*$/u.test(trimmed)
      ? 0.18
      : 0;
  return Math.round(Math.max(90, (words + punctFactor) * msPerWord));
}

function isDet(w: string): boolean {
  return PURE_DETERMINERS.has(w) || DEMONSTRATIVES.has(w);
}

function isAdjLike(w: string): boolean {
  return COMMON_ADJECTIVES.has(w) || (w.length > 4 && /(?:est|ful|ous|ive|able|ible|less|ish|ant|ent|al|ic)$/u.test(w) && !FINITE_VERBS.has(w));
}

function isAdvLike(w: string): boolean {
  return DEGREE_ADVERBS.has(w) || (w.length > 4 && w.endsWith("ly") && !COMMON_ADJECTIVES.has(w));
}

function isVerbToken(w: string, prevLower?: string): boolean {
  if (!w) return false;
  if (prevLower && (isDet(prevLower) || PREPOSITIONS.has(prevLower) || prevLower === "of" || isAdjLike(prevLower))) {
    return false;
  }
  return AUXILIARIES.has(w) || FINITE_VERBS.has(w) || (w.length > 4 && /(?:ed|es|ize|ise|ify|ate)$/u.test(w) && !isAdjLike(w));
}

/** Batch at sentence boundaries; this is a request size, never a phrase length. */
export function readingPassages(chunks: Chunk[]): Passage[] {
  const result: Passage[] = [];
  for (const p of readingParagraphs(chunks)) {
    const chunk = chunks.find((c) => c.id === p.chunkId)!;
    let start = 0;
    while (start < p.text.length) {
      while (/\s/u.test(p.text[start] || "") && start < p.text.length) start++;
      if (start >= p.text.length) break;
      let end = start;
      do { end += firstSentenceEnd(p.text.slice(end)); } while (end < p.text.length && end - start < 1200);
      const text = p.text.slice(start, end).trimEnd();
      result.push({ key: `${p.chunkId}:${p.start + start}`, kind: "phrase", chunkId: p.chunkId,
        start: p.start + start, end: p.start + start + text.length, text, page: chunk.page });
      start = end;
    }
  }
  return result;
}

export function wordRanges(text: string, wordStep = 1): TextRange[] {
  const words = [...text.matchAll(WORD_TOKEN_RE)];
  if (!words.length) return text.trim() ? [{ start: text.search(/\S/u), end: text.trimEnd().length }] : [];
  const singles = words.map((word, i) => {
    const start = i === 0 ? text.search(/\S/u) : word.index;
    const next = words[i + 1]?.index ?? text.length;
    // Closing punctuation travels with the word. No whitespace is fabricated.
    const end = next - (text.slice(word.index + word[0].length, next).match(/\s*$/u)?.[0].length || 0);
    return { start, end };
  });
  const step = normalizeWordStep(wordStep);
  if (step <= 1) return singles;
  const grouped: TextRange[] = [];
  let i = 0;
  while (i < singles.length) {
    let last = i;
    while (last + 1 < singles.length && last - i + 1 < step) {
      const slice = text.slice(singles[last].start, singles[last].end);
      if (/[.!?…][)\]"”’»]*$/u.test(slice) && !ABBREV_RE.test(slice) && !/^\p{Lu}\.$/u.test(slice)) {
        break;
      }
      last++;
    }
    grouped.push({ start: singles[i].start, end: singles[last].end });
    i = last + 1;
  }
  return grouped;
}

/**
 * Local grammatical/syntactic phrase segmentation (0ms, zero fixed word-count rules).
 * Groups determiner/modifier/noun phrases, bound "of" complements, auxiliary/infinitive
 * verb chains, phrasal verbs, relative clauses, and Turkish postpositional/converb units.
 */
export function grammarRanges(text: string): TextRange[] {
  const words = wordRanges(text, 1);
  if (words.length <= 1) return words;

  const tokens = words.map((w) => {
    const raw = text.slice(w.start, w.end);
    const core = raw.replace(/^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu, "");
    const lower = core.toLowerCase();
    const endsPunct = /[,;:—–.!?…][)\]"”’»]*$/u.test(raw) && !ABBREV_RE.test(raw) && !/^\p{Lu}\.$/u.test(raw);
    const startsOpen = /^[(\["“‘«—–]/u.test(raw);
    return { ...w, raw, core, lower, endsPunct, startsOpen };
  });

  const ranges: TextRange[] = [];
  let phraseStart = 0;

  const hasVerbInPhrase = (from: number, to: number): boolean => {
    for (let k = from; k <= to; k++) {
      const prev = k > from ? tokens[k - 1].lower : undefined;
      if (isVerbToken(tokens[k].lower, prev)) return true;
    }
    return false;
  };

  // Count how many words belong to an upcoming Noun Phrase starting at `idx`.
  const upcomingNpLength = (idx: number): number => {
    let count = 0;
    for (let k = idx; k < tokens.length; k++) {
      const t = tokens[k];
      if (k > idx && (SUBORDINATORS_AND_RELATIVES.has(t.lower) || COORDINATORS.has(t.lower) ||
          NOMINATIVE_PRONOUNS.has(t.lower) || AUXILIARIES.has(t.lower) ||
          (PREPOSITIONS.has(t.lower) && t.lower !== "of") || t.lower === "to")) {
        break;
      }
      if (k > idx && isVerbToken(t.lower, tokens[k - 1]?.lower)) break;
      count++;
      if (t.endsPunct) break;
    }
    return count;
  };

  for (let i = 0; i < tokens.length - 1; i++) {
    const curr = tokens[i];
    const next = tokens[i + 1];
    const phraseLen = i - phraseStart + 1;
    const hasVerb = hasVerbInPhrase(phraseStart, i);

    const shouldSplit = (): boolean => {
      // 1. Explicit punctuation or parenthetical boundaries
      if (curr.endsPunct) return true;
      if (next.startsOpen && phraseLen >= 2) return true;

      // 2. Hard syntactic bindings (never split inside these constituent pairs)
      if (PURE_DETERMINERS.has(curr.lower) || DEGREE_ADVERBS.has(curr.lower) || curr.lower === "of" || curr.lower === "to") {
        return false;
      }
      if (DEMONSTRATIVES.has(curr.lower) && !NOMINATIVE_PRONOUNS.has(next.lower) && !AUXILIARIES.has(next.lower)) {
        return false;
      }
      if (isAdvLike(curr.lower) && !SUBORDINATORS_AND_RELATIVES.has(next.lower) && !COORDINATORS.has(next.lower) && !PREPOSITIONS.has(next.lower)) {
        return false;
      }
      if (isAdjLike(curr.lower) && !SUBORDINATORS_AND_RELATIVES.has(next.lower) && !COORDINATORS.has(next.lower) &&
          !PREPOSITIONS.has(next.lower) && next.lower !== "to" && !NOMINATIVE_PRONOUNS.has(next.lower) &&
          !AUXILIARIES.has(next.lower) && !isVerbToken(next.lower, curr.lower)) {
        return false;
      }
      // Tightly bound "of" noun complements ("the art of discussion", "a useful piece of advice")
      if (next.lower === "of" && !hasVerb && phraseLen <= 4) {
        return false;
      }
      // Subject pronoun or clause-initial relative/wh-word binds to its verb/auxiliary ("What I", "I had", "who lives", "She came")
      if (NOMINATIVE_PRONOUNS.has(curr.lower) ||
          (i === phraseStart && (curr.lower === "what" || curr.lower === "who" || curr.lower === "which" || curr.lower === "that"))) {
        return false;
      }
      // Auxiliary and verb-internal adverbs bind forward, except when "be/been" finishes a verb chain before a new NP/PP
      if (AUXILIARIES.has(curr.lower) || VERB_ADVERBS.has(curr.lower)) {
        if ((curr.lower === "be" || curr.lower === "been") && phraseLen >= 3 && (isDet(next.lower) || PREPOSITIONS.has(next.lower))) {
          return true;
        }
        return false;
      }
      if (VERB_ADVERBS.has(next.lower) && (AUXILIARIES.has(curr.lower) || NOMINATIVE_PRONOUNS.has(curr.lower))) {
        return false;
      }
      // Phrasal verb particles ("came up", "giving up") and bound prepositions ("came up with")
      if (PHRASAL_PARTICLES.has(next.lower) && (hasVerb || curr.lower.endsWith("ing"))) {
        return false;
      }
      if (PHRASAL_PARTICLES.has(curr.lower) && (next.lower === "with" || next.lower === "for" || next.lower === "to") && phraseLen <= 3) {
        return false;
      }
      // Infinitive "to + verb" chains ("had taken to be", "decided to continue")
      if (next.lower === "to" && INFINITIVE_VERBS.has(curr.lower)) {
        const afterTo = tokens[i + 2]?.lower || "";
        if (AUXILIARIES.has(afterTo) || FINITE_VERBS.has(afterTo) || (!isDet(afterTo) && !isAdjLike(afterTo))) {
          return false;
        }
      }
      // Verb + object pronoun ("gave me", "told him")
      if (OBJECT_PRONOUNS.has(next.lower) && hasVerb) {
        return false;
      }
      // Modal/verb + gerund + single-word object ("would mean losing everything.")
      if (hasVerb && next.lower.endsWith("ing") && !PREPOSITIONS.has(curr.lower)) {
        return false;
      }
      if (hasVerb && curr.lower.endsWith("ing") && i + 1 === tokens.length - 1) {
        return false;
      }
      // Avoid stranding a single bare verb at the start of a phrase ("requires patience")
      if (phraseLen === 1 && isVerbToken(curr.lower) && !SUBORDINATORS_AND_RELATIVES.has(next.lower) && !NOMINATIVE_PRONOUNS.has(next.lower)) {
        return false;
      }
      // Turkish postpositions always attach to the preceding noun phrase ("bunun için", "her şeye rağmen")
      if (TURKISH_POSTPOSITIONS.has(next.lower)) {
        return false;
      }

      // 3. Natural grammatical constituent boundaries (split before/after)
      if (TURKISH_POSTPOSITIONS.has(curr.lower) && phraseLen >= 2) {
        return true;
      }
      if (curr.lower.length >= 5 && /(?:[ıiuü]p|[ae]r[ae]k|d[ıiuü]kç[ae]|m[ae]d[ae]n|[ıiuü]nc[ae]|maksızın|meksizin)$/iu.test(curr.lower)) {
        return true;
      }
      if (SUBORDINATORS_AND_RELATIVES.has(next.lower)) {
        return true;
      }
      if (next.lower === "that" && phraseLen >= 2) {
        const afterThat = tokens[i + 2]?.lower || "";
        if (NOMINATIVE_PRONOUNS.has(afterThat) || AUXILIARIES.has(afterThat) || isVerbToken(afterThat)) {
          return true;
        }
      }
      if (COORDINATORS.has(next.lower) && phraseLen >= 2) {
        return true;
      }
      // Contact relative clause or new subject pronoun ("the largest object | I had ever seen")
      if (NOMINATIVE_PRONOUNS.has(next.lower) && !SUBORDINATORS_AND_RELATIVES.has(curr.lower) &&
          !COORDINATORS.has(curr.lower) && curr.lower !== "what" && curr.lower !== "that") {
        return true;
      }
      // Finite verb or modal auxiliary starting after a multi-word Subject NP or relative/subordinate clause
      if ((AUXILIARIES.has(next.lower) || isVerbToken(next.lower, curr.lower)) && phraseLen >= 3) {
        return true;
      }
      // Multi-word Noun Phrase starting after a verb, object pronoun, or phrasal-verb preposition
      if (hasVerb && isDet(next.lower)) {
        if (OBJECT_PRONOUNS.has(curr.lower) || PREPOSITIONS.has(curr.lower) || curr.lower === "be" || curr.lower === "been") {
          return true;
        }
        if (upcomingNpLength(i + 1) >= 3) {
          return true;
        }
      }
      // Prepositional phrase boundary after a completed noun/verb phrase ("a surprisingly simple solution | to a very difficult problem.")
      if ((PREPOSITIONS.has(next.lower) || next.lower === "to") && phraseLen >= 2) {
        return true;
      }

      return false;
    };

    if (shouldSplit()) {
      ranges.push({ start: tokens[phraseStart].start, end: curr.end });
      phraseStart = i + 1;
    }
  }

  ranges.push({ start: tokens[phraseStart].start, end: tokens[tokens.length - 1].end });
  return ranges;
}

export function passageUnits(p: Passage, ranges: TextRange[], kind: FineMode, provisional = false): FineUnit[] {
  const unitKind: SourceUnit["kind"] = kind === "word" ? "word" : "phrase";
  return ranges.map((r) => ({
    kind: unitKind,
    chunkId: p.chunkId,
    page: p.page,
    start: p.start + r.start,
    end: p.start + r.end,
    text: p.text.slice(r.start, r.end),
    passageKey: p.key,
    ...(provisional ? { provisional: true } : {}),
  }));
}

export function fineUnits(
  passages: Passage[],
  mode: FineMode,
  cache: Map<string, TextRange[]>,
  fallbackToGrammar = false,
  wordStep: WordStep = 1,
): FineUnit[] {
  return passages.flatMap((p) => {
    if (mode === "word") return passageUnits(p, wordRanges(p.text, wordStep), "word");
    if (mode === "grammar") return passageUnits(p, grammarRanges(p.text), "grammar");
    const cached = cache.get(p.key);
    if (cached) return passageUnits(p, cached, "phrase");
    if (fallbackToGrammar) return passageUnits(p, grammarRanges(p.text), "phrase", true);
    return [{ ...p, passageKey: p.key, pending: true }];
  });
}

export function unitAt(units: SourceUnit[], point: { chunkId: string; start: number } | undefined): number {
  if (!point) return 0;
  const within = units.findIndex((u) => u.chunkId === point.chunkId && u.start <= point.start && u.end > point.start);
  if (within >= 0) return within;
  const after = units.findIndex((u) => u.chunkId && u.chunkId === point.chunkId && u.start >= point.start);
  if (after >= 0) return after;
  const last = units.findLastIndex((u) => u.chunkId === point.chunkId);
  return Math.max(0, last);
}

/** Build bookmarks/AI selections from original slices, including exact intervening whitespace. */
export function exactFineSpans(chunks: Chunk[], selected: SourceUnit[]): Array<BookmarkSpan & { text: string }> {
  if (!selected.length) return [];
  const first = selected[0], last = selected[selected.length - 1];
  const lo = chunks.findIndex((c) => c.id === first.chunkId), hi = chunks.findIndex((c) => c.id === last.chunkId);
  if (lo < 0 || hi < lo) return [];
  return chunks.slice(lo, hi + 1).map((c, i, all) => {
    const start = i === 0 ? first.start : 0, end = i === all.length - 1 ? last.end : c.text.length;
    return { chunkId: c.id, page: c.page, start, end, text: c.text.slice(start, end) };
  });
}
