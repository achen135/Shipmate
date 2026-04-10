/**
 * The Simple-mode "keyword match": how many of the posting's words also
 * appear in the user's resume. Deliberately crude (CLAUDE.md M5): plain words,
 * no AI, no idea which words matter. A posting's repeated words count for
 * more, and the boilerplate every posting shares is ignored. AI mode
 * replaces this with a real fit score (M6/M7), which is why the UI calls it
 * "keyword match" and not "fit".
 */

const STOPWORDS = new Set(
  `a about above across after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each either else etc even every few for from further get gets given had has have having he her here hers him his how however i if in include includes including into is it its itself just like make many may me might more most must my no nor not now of off on once one only or other our ours out over own per same she should so some such than that the their theirs them then there these they this those through to too under until up upon us use used using very via was we well were what when where whether which while who whom why will with within without would you your yours
ability able apply applicants applicant application applications benefits candidate candidates career careers client clients collaborate collaborating collaboration committed communicate communication company companies culture currently day days description diverse diversity duties employee employees employer employment environment equal excellent experience experiences field fit full fulltime gain good great group growth help helping hire hiring ideal identify impact individual individuals interested internship internships intern interns job join know learn learning level life location looking love mission need needs new next number offer opportunities opportunity organization part partner passion passionate people performance plus position positions preferred pursuing qualifications qualified recruiting related relevant remote report require required requirements responsibilities responsible role roles salary seeking service services skill skills solutions someone start strong student students summer support take team teams term things time together top understand unique university want ways week weeks while who work working world year years
january february march april may june july august september october november december spring fall winter
`
    .split(/\s+/)
    .filter(Boolean),
);

/** Words and the tech spellings that punctuation would otherwise split. */
const TOKEN = /[a-z0-9][a-z0-9+#.\-]*/g;

/**
 * "APIs" → "api", "systems" → "system". Leaves "ss" endings, short words, and
 * anything with punctuation ("c++", "node.js") alone.
 */
function stem(word: string): string {
  if (
    /^[a-z]+$/.test(word) &&
    word.length > 3 &&
    word.endsWith("s") &&
    !word.endsWith("ss")
  ) {
    return word.slice(0, -1);
  }
  return word;
}

function clean(raw: string): string {
  // "python." at the end of a sentence; ".net" keeps its dot only if leading.
  return raw.replace(/[.\-]+$/g, "");
}

type Term = {
  count: number;
  /** The spelling to show: as first written. */ word: string;
};

function analyze(text: string): Map<string, Term> {
  const terms = new Map<string, Term>();
  for (const match of text.toLowerCase().matchAll(TOKEN)) {
    const word = clean(match[0]);
    const key = stem(word);
    if (key.length < 2 || /^\d+$/.test(key) || STOPWORDS.has(key)) continue;
    if (STOPWORDS.has(word)) continue;
    const term = terms.get(key);
    if (term) term.count += 1;
    else terms.set(key, { count: 1, word });
  }
  return terms;
}

/** Meaningful lowercase words (stemmed) with how often each appears. */
export function termCounts(text: string): Map<string, number> {
  return new Map([...analyze(text)].map(([key, term]) => [key, term.count]));
}

export type KeywordMatch = {
  /** 0-100, or null when there isn't enough text on either side to compare. */
  score: number | null;
  matched: string[];
  missing: string[];
};

/** Fewer distinct posting words than this and the comparison means nothing. */
export const MIN_POSTING_TERMS = 8;
export const MIN_RESUME_TERMS = 20;
const LIST_SIZE = 12;

export function keywordMatch(
  posting: {
    title: string;
    category: string | null;
    description: string | null;
  },
  resumeText: string | null,
): KeywordMatch {
  const wanted = analyze(
    // The title is what the role is about; count it three times.
    `${`${posting.title} `.repeat(3)} ${posting.category ?? ""} ${posting.description ?? ""}`,
  );
  const have = analyze(resumeText ?? "");
  if (wanted.size < MIN_POSTING_TERMS || have.size < MIN_RESUME_TERMS) {
    return { score: null, matched: [], missing: [] };
  }

  let total = 0;
  let hit = 0;
  const matched: [string, number][] = [];
  const missing: [string, number][] = [];
  for (const [key, { count, word }] of wanted) {
    total += count;
    if (have.has(key)) {
      hit += count;
      matched.push([word, count]);
    } else {
      missing.push([word, count]);
    }
  }
  const top = (list: [string, number][]) =>
    list
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, LIST_SIZE)
      .map(([word]) => word);
  return {
    score: Math.round((hit / total) * 100),
    matched: top(matched),
    missing: top(missing),
  };
}
