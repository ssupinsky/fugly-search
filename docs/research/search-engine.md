# Line search engine research (fugly-search)

NOTE: revised after fetching 4 pages (see Sources). Items tagged [verified] come from those pages.
[measured] = our own benchmark, section 9 (code: docs/research/bench/). Everything else untagged is UNVERIFIED prior knowledge.

## 1. How other tools score/search lines

- ripgrep: no ranking [verified]. Rust regex extracts literals; memchr on the rarest byte of a literal (frequency table),
  Teddy SIMD for alternations; skips hidden/binary by default; full .gitignore semantics (later patterns win)
  [verified]. Reported (2016, EC2 c3.2xlarge): Linux kernel literal search 0.349s, ~1GB English subtitles literal 0.268s
  [verified]. Takeaway: a full-corpus literal scan is hundreds of ms for GBs, so ~60MB should be tens of ms (extrapolation, unverified).
- fzf v1/v2 (junegunn/fzf, algo/algo.go): modified Smith-Waterman (V2, optimal, O(nm); falls back to V1 for patterns >1000 chars) [verified].
  Constants [verified]: scoreMatch 16, gapStart -3, gapExtension -1, bonusBoundary 8, bonusNonWord 8, bonusCamel123 7,
  bonusConsecutive 4 (minimum), bonusFirstCharMultiplier 2, bonusBoundaryWhite 10, bonusBoundaryDelimiter 9.
  V1 is greedy O(n): forward scan then backward tighten, not guaranteed best [verified]. Extended syntax: space = AND of terms,
  ^prefix, suffix$, 'exact, !negate. This is exactly our "all words any order" model.
- VS Code quick open: src/vs/base/common/fuzzyScorer.ts + filters.ts. Per-char scoring, bonus for
  same-case, start of word, separator, camelCase, consecutive; label (filename) matched first and
  weighted above path. Multi-word query = every piece must match (scoreItemFuzzy with pieces).
- WebStorm Search Everywhere: MinusculeMatcher (IntelliJ platform), "NameUtil" word-prefix matching:
  query chars match at word starts (camel/snake humps) preferred; contiguous and prefix matches rank higher.
- Sublime: fuzzy subsequence with bonuses for consecutive, word start, and filename match (closed source; docs describe).
- zoekt (sourcegraph/zoekt): positional trigram index (ngram -> posting list of offsets), query narrows
  candidates by intersecting two trigram postings at fixed distance, then verifies. Index ~3x corpus size on disk.
  Ranking: filename match, symbol match, word boundary, then file-level scores.
- uFuzzy [verified, README, Oct 2023, Ryzen 7 5850U, Chrome 117, 162k phrases / 4MB, 86 typed queries total]:
  uFuzzy 434ms total search, 28MB peak heap, 0.5ms init; with external prefix caching 210ms; fuzzysort 1321ms, 175MB peak,
  50ms init; FlexSearch Light 83ms search but 3210ms init and 670MB peak; Fuse.js 33875ms.
  Supports outOfOrder terms (3-term search over 162k phrases ~5ms per README) and intraMode 1 = one error
  (substitution/transposition/insertion/deletion) per term. Regex based; 162k phrases is ~6x smaller than our 1M lines of longer text.
- fuzzysort: README fetch 404'd; only the uFuzzy table above is verified. Prepared-target/bitflag design is unverified recall.
- flexsearch: fastest queries in the table above but huge init time and memory (670MB peak for 4MB of data) [verified]. Poor fit for 1M lines.

## 2. Node implementation options

Line store (recommended):
- One big `Uint8Array`/Buffer of all text (UTF-8) plus `Uint32Array lineStart` (offset) and
  `Uint32Array`/`Uint16Array lineLen`, `Uint32Array lineFile` (file id). 1M lines x ~60B = ~60MB text
  + 12MB metadata. No JS strings per line (avoids ~40+B/obj overhead and GC pressure).
- Separate lowercase copy (ASCII fold) for case-insensitive scan: another 60MB. Or fold on the fly in the scan loop.
  Budget: ~2.2x text size.
- Large pages in SharedArrayBuffer so main thread / multiple workers can read without copying.

Per-term search:
- `buffer.indexOf(needle, from)` is native (memchr/SIMD-ish, Boyer-Moore-Horspool-like for longer needles in V8/Node);
  scanning the whole 32.5MB corpus for one term cost 12.5ms for a no-hit term (anchor strategy A, includes line mapping) [measured]. Run on the single big buffer, not per line,
  then binary search `lineStart` to map hit offset -> line (skip to next line start after a hit).
- For AND of K terms: scan the rarest term (longest, or sampled lowest frequency) across the whole buffer,
  then verify other terms only within matched lines. Cost ~ one scan + small verification.

Bitmask prefilter (cheap, big win):
- Per line `Uint32Array charMask` (26 letters + digits/_/- bits). Query mask Q; candidate iff (mask & Q) === Q.
  Rejects most lines in a tight typed-array loop: [measured] mask-prefilter + per-line verify over all 1M lines is the fastest first-keystroke strategy (see 9); also good for the fuzzy/typo path.
  Memory +4MB.

Trigram index:
- Map trigram(24-bit via lowercase bytes hashed to 2^18-2^21 buckets) -> Uint32Array postings of line ids (sorted).
  Query: intersect postings of the term's trigrams (start with the smallest). Gives candidate lines in ~sub-ms for
  terms >= 3 chars. Memory: unmeasured, guess 1-2x text if line-level postings with delta+varint; 4-8x if raw Uint32.
  Build cost: unmeasured. Not built: strategy D worst case was 54ms, so trigram is deferred. Use when corpus > ~500k lines or queries are rare-term heavy;
  for <=1M lines, the indexOf scan (30ms) may be good enough; add trigram only if profiling demands.
  Terms of 1-2 chars: skip index, use incremental narrowing (below).

Prefix / word-start support: scan is substring based, so prefix matches come free ("tok" finds "token").
Prefer word-start hits via scoring, not via index.

Typo tolerance: second-tier only. If strict AND-substring gives < N (say 20) results, run fuzzy pass:
bitmask prefilter -> subsequence match per term (fzf V1 greedy) -> allow 1 transposition/substitution for terms >= 5 chars
(single-error via uFuzzy-style regex or Damerau on word tokens). Never run on every keystroke over all lines.

camelCase / snake_case awareness: compute char-class at scoring time from the raw bytes
(lower->Upper transition, `_`, `-`, `/`, `.`, space, digit boundary). Also normalise the query: split "authToken"
-> terms [auth, token]. No need to index tokens.

## 3. Incremental narrowing while typing

- Keep `lastQuery` and `lastCandidates: Uint32Array` (line ids). If new query (after lowercase, normalised) extends the old
  one (each old term is a prefix of a new term, or a new term was appended), the new match set is a SUBSET:
  re-verify only lastCandidates. Typing "aut"->"auth" costs microseconds-ms.
- On backspace or non-extension, fall back to the cache stack (keep last ~8 candidate sets keyed by query) else full scan.
- Cap candidate set: if > ~200k, keep it unscored as ids only; score lazily the top-K.
- Top-K: keep a binary heap of size K (e.g. 200 rendered, 1000 kept); never fully sort 1M.

## 4. Cancellation of stale queries

- Worker receives `{id, query}`. Search runs in chunks of ~50k lines (about 1-4 ms); between chunks do
  `await new Promise(setImmediate)` or check a shared flag.
- Fastest: `SharedArrayBuffer Int32Array ctrl`; main thread does `Atomics.store(ctrl,0,latestId)`; the search loop
  reads `Atomics.load(ctrl,0) !== myId` every chunk and bails. Works even while the worker is busy (messages can't be read mid-loop).
- Only post results for the id still current. Debounce is unnecessary if search < ~30ms; otherwise 0-30ms.
- Post results as transferable typed arrays (ids, scores, packed match ranges), not objects.

## 5. Indexing, memory, file filters

- Walk: `git ls-files -z` (+ `--others --exclude-standard`) if a git repo: fastest and exactly respects ignores.
  Else walk with `fs.opendir` + the `ignore` package (kaelzhang/node-ignore): one `ignore()` instance per directory
  .gitignore, test with paths relative to that dir and trailing `/` for dirs; prune ignored dirs; always skip `.git`,
  `node_modules` unless opted in. Add own default ignore list (dist, build, .next, lockfiles, *.min.js, *.map).
- Binary: ripgrep skips binary by default [verified]; NUL-byte-in-first-8KB check is the common heuristic (unverified detail). Also skip by extension (png, jpg, zip, wasm...).
- Size: skip files > 1MB (configurable), and individual lines > ~2000 chars (truncate or skip: minified code).
  Global budget: stop/limit at e.g. 1.5M lines or 250MB text, surface "index truncated" in UI.
- Read with `fs.promises.readFile` into Buffer, pool concurrency ~16-32; split lines by scanning for 0x0A in-place
  (no `toString().split`). Handle \r\n by trimming. Store only non-empty trimmed lines; store leading-indent offset.
- Memory budget target for 1M lines: text 60MB + lowered 60MB + meta 16MB + masks 4MB + file table ~ small ; measured: 75MB of typed arrays for a 32.5MB corpus (text+lower+off+len+mask = 2.3x text) [measured].
  Set worker `resourceLimits: { maxOldGenerationSizeMb: 512 }` (typed arrays live off-heap anyway).
- Index time: building the store from in-memory strings took ~300ms for 1M lines [measured]; disk read/walk time NOT measured. Report progress; allow search while indexing (search what's built).

## 6. Watching for incremental reindex on macOS

- `fs.watch` with `{recursive:true}` on macOS uses FSEvents natively (Node >= 14ish), low overhead, but: coarse events
  (rename vs change only), no filename on some events, no ignore filtering at the source (you still receive node_modules churn).
- chokidar v4 (2024, dropped fsevents dep and glob support) / v3 (used fsevents): handles atomic-save quirks,
  dedupe, awaitWriteFinish, `ignored` function. chokidar 3 + fsevents = native efficient on mac; v4 uses fs.watch per directory
  (more FDs on huge trees; risk EMFILE) -- verify in the changelog.
- Recommendation: `@parcel/watcher` [verified README]: prefers FSEvents on macOS (Watchman, kqueue alternatives), `ignore` option
  (paths/globs via picomatch; ignored paths emit no events), events throttled/coalesced in C++ (one event per file; git checkout
  or npm install => single notification), snapshots (`writeSnapshot`/`getEventsSince`) usable to resync after the app was closed;
  used by Parcel 2, VSCode, Nx, Nuxt and others. Best fit for big trees; fallback chokidar (unverified). If keeping zero native deps: fs.watch recursive + own ignore filter + 50-100ms debounce.
- Reindex per file: on change, re-read the file, append its new lines to the end of the buffers (append-only arena with
  capacity doubling) and mark old line range of that file as dead via a `Uint8Array alive` bitmap (or tombstone `lineLen=0`).
  Compact when dead > 25%. Avoid shifting arrays.

## 7. Match ranges for highlighting

- Only compute for the final top-K (<=200 lines), on the main raw line text.
- For each term: find all occurrences (indexOf on the lowercased line), choose the best occurrence per term
  (prefer word-start, then earliest) so highlights agree with the score. Fuzzy-tier terms: positions from the fzf V1 greedy backtrack.
- Merge overlapping/adjacent intervals, send as flat `Uint16Array [s0,e0,s1,e1...]` per line (columns in UTF-16 code units; convert
  from byte offsets if non-ASCII, e.g. fast path: line is ASCII -> identity).

## 8. Recommended design

Data:
```
text:   Uint8Array (SAB)      all lines concatenated, '\n' separated
lower:  Uint8Array (SAB)      ASCII-folded copy (non-ASCII untouched)
lineOff:Uint32Array, lineLen:Uint16Array, lineFile:Uint32Array, mask:Uint32Array, alive:Uint8Array
files:  string[] paths, fileNameStart per line via files table; fileLower: string[]
ctrl:   Int32Array(SAB)       [0]=latest query id
```
Query parse: split on whitespace and camel/snake boundaries -> terms (lowercased, dedupe, length>=1).
Terms of length 1 only count after at least one term >= 2 exists (else too many hits).

Pipeline (strict tier):
```
search(q, id):
  terms = parse(q); if extends(prev) cand = prevCand else cand = ALL
  anchor = longest term
  if cand===ALL and anchor.len>=3 and trigram index exists: cand = trigramIntersect(anchor)
  elif cand===ALL: cand = scanAll(lower, anchor)           // indexOf loop, map offset->line via binary search
  heap = TopK(K)
  for chunk of cand (50k):
     if Atomics.load(ctrl,0)!==id return CANCELLED
     for line in chunk:
        if !alive[line] continue
        if (mask[line] & qmask) !== qmask continue
        s = scoreLine(line, terms); if s>0 heap.push(line,s)
  if heap.size < 20 and terms.some(t=>t.len>=4): fuzzy tier (append, discounted x0.5)
  post {id, ids, scores, ranges(for top K)}; store cand as prevCand
```

scoreLine (all terms must hit, else 0):
```
total = 0
for t in terms:
   best = -inf
   for each occurrence p of t in lower line (cap 8 occurrences):
      s = 10*t.len                                   // base per matched char
      if p==indent or isBoundary(prev,cur): s += 30   // word start (space, _ - . / ( " , or lower->Upper in raw)
      if p+t.len==end or isBoundary at end: s += 10   // whole-word end
      if t equals whole word exactly: s += 20
      if raw case matches exactly (user typed uppercase): s += 5
      best = max(best, s)
   total += best
// cross-term bonuses
if terms appear in query order: total += 15
span = maxEnd - minStart (of chosen occurrences); total += clamp(60 - span, 0, 60) * 0.5   // proximity ("consecutive" bonus: terms adjacent => +30)
total -= 0.1 * min(lineLenTrimmed, 300)                // length penalty (shorter = tighter match)
total -= 0.5 * indentDepth                              // slight de-prioritise deeply indented
fileBonus: for each term in file base name: +25; in path dir: +8
          (compare against fileLower[lineFile]; precompute per file per query, cache in a Float32Array by file id)
tiebreak: shorter path, then lower line number
```
Fuzzy tier scoring: fzf-V1 greedy subsequence per term (gap -3/-1, boundary +8, consecutive +4), total scaled by 0.5 so strict hits always rank first.
Constants are starting points: tune against a labelled set of ~30 real queries.

Perf: see section 9 (measured). Strategy D (mask prefilter + per-line verify + score) replaces the anchor-indexOf scan (A) in the
pseudo-code above: for the "cand===ALL" branch run `for li in 0..n: mask check; verify all terms; score`. Keep the incremental candidate set.

Build order: (1) buffers + indexOf AND + scoring + cancellation, (2) incremental candidate cache, (3) mask prefilter + fuzzy tier,
(4) @parcel/watcher incremental updates, (5) trigram index only if benchmarks demand.

## 9. Measured benchmark (this machine)
Code: docs/research/bench/{engine,corpus,bench}.js; run `node --expose-gc bench.js`.
Machine: Apple M1 Pro, Node v24.18.0, macOS. Corpus: synthetic code-like, 1,000,000 lines, 32.5MB (avg ~32B/line; real repos
likely 2x bytes, so scale scan times ~2x). Method: median of 7 runs (3 for B/C), in-process timers, run on main thread and again inside
a worker_threads Worker (numbers within ~5% of each other; Worker rss is higher, ~740MB-1GB vs 565MB, due to the generated string
corpus kept alive by the benchmark, not by the store). No cancellation checks in timed loops.
Build: typed-array store (text+lower+offsets+lengths+mask) from strings: ~300-360ms; typed arrays = 75MB.
Strategies: A anchor-indexOf over whole buffer then verify+score; B naive per-line JS string `includes`; C mask+per-line scan, no scoring;
D = C plus verify-all-terms plus scoring/top-200 (the real candidate for production).
First-keystroke (ms, main thread):
| query | matches | A | B | D |
|---|---|---|---|---|
| value (common) | 64k | 34 | 34 | 29 |
| authtoken | 1.0k | 19 | 53 | 9 |
| xzzzz (no hit) | 0 | 13 | 32 | 8 |
| auth token | 1.1k | 34 | 64 | 10 |
| auth token refresh | 1.1k | 52 | 61 | 8 |
| const return (2 common) | 5.5k | 61 | 48 | 25 |
| ser con res | 16k | 75 | 57 | 43 |
| au (2 chars) | 133k | 78 | 56 | 54 |
Incremental typing "auth token ref" with D over previous candidates (ms incremental vs full rescan): a 98/95 (690k matches),
au 53/53, aut 25/49, auth 9.4/21.5, "auth t" 4/23.5, "auth to" 2.4/19.4, "auth tok" 1.3/10, "auth token" 0.5/9.7, later chars 0.6/8-10.
Findings: (1) D wins or ties in 7 of 8 rows; the indexOf anchor scan (A) loses because mapping hits to lines and per-hit overhead
beats native speed at this corpus size, and it is slowest for common anchors. Trigram index NOT built: worst measured D is 54ms.
(2) 1-2 char / very common terms are the cost driver (scoring 130k-690k candidates): cap scoring, or require >=3 chars total before
scoring everything, or show partial results. (3) Incremental narrowing makes typing past 3 chars cost ~1-10ms. (4) Worker adds no
measurable overhead to search; postMessage cost NOT measured. (5) Not measured: disk walk/read, watcher updates, fuzzy tier, highlighting,
SharedArrayBuffer-in-worker variants, cancellation checks, non-ASCII text, realistic repo text.

## 10. Final recommendation
Typed-array store (text, lowercase, offsets, lengths, 28-bit char mask) in a worker; per query: parse terms, if the query extends the previous
one filter the previous candidate Int32Array, else mask-prefilter scan of all lines (strategy D); score with the formula in section 8
into a size-200 top-K; Atomics cancellation checked per 64k lines. Expect ~10ms typical, ~55ms worst case at 1M short lines on M1-class
hardware. Defer trigram index and fuzzy tier until real-repo benchmarks show a need.

## Sources (pages actually fetched)
- https://raw.githubusercontent.com/junegunn/fzf/master/src/algo/algo.go
- https://raw.githubusercontent.com/leeoniya/uFuzzy/main/README.md
- https://raw.githubusercontent.com/parcel-bundler/watcher/master/README.md
- https://burntsushi.net/ripgrep/ (first 100k of 121k chars read)
- https://raw.githubusercontent.com/farzher/fuzzysort/master/README.md (tagline "<1ms for 13,000 files"; no methodology; long targets slow it)
- https://raw.githubusercontent.com/paulmillr/chokidar/main/README.md (v4 Sep 2024: dropped globs and fsevents, deps 13->1; fs.watch default)
Fetch failed: https://code.visualstudio.com/blogs/2021/11/15/vscode-search-performance (404).
Search only (not fetched): https://deepwiki.com/microsoft/vscode/11-search (AI-generated wiki: ripgrepTextSearchEngine.ts under
src/vs/workbench/services/search/node/; VS Code drives search with ripgrep), VS Code wiki Search Issues, fzf README on sources.debian.org.
Pages fetched successfully: 6.

## Still UNVERIFIED
VS Code fuzzyScorer and search internals (only a search-snippet), WebStorm MinusculeMatcher, Sublime, zoekt design/index sizes, chokidar v3/v4 behaviour, node-ignore usage,
fuzzysort internals, trigram memory/build numbers, chokidar macOS runtime behaviour, and all scoring constants in section 8
(our own starting values).
