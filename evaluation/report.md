# Valuation evaluation

Implemented `launch-3`: ordinary least squares in log market cap / log TVL, unchanged shrunk category residuals (`k=5`), no default winsor clipping, and neutral growth, tenure, and breadth factors. Existing interfaces and configurable factor functions remain compatible. No names or individual target values are hardcoded. The selected change simplifies the model; the evidence supports a modest development-set improvement, not a claim of reliable launch valuation.

## Data and split

- Original implementation: git `d88e92297affb609799799b2923b5e115f078b77:lib/model.ts`, loaded directly by the evaluation script.
- Snapshot: `2026-11-14`, SHA-256 `42a71213519479f3a180cc5010cbbf6bd18a2447fa0ad29e4c5122b6c9184393`.
- 758 protocols; 128 positive-TVL, positive-market-cap comps; 95 dated comps.
- Unchanged outer split: sort dated comps by listing date then slug, take earliest floor(70%) = 66 for training and remaining 29 for evaluation. Cutoff `2025-01-29`. The same 33 undated comps are excluded from both before/after outer evaluation; production fitting still uses all usable comps.
- Exact train/test slugs, per-row predictions and full-precision metrics are saved in `results.json`.

**This is a development holdout, previously inspected historically.** Every TVL and market cap is from the same snapshot. Listing-date separation is not a forward-in-time market backtest, and this run cannot erase prior knowledge of the holdout.

## Selection protocol

Declared six candidates before reading outer scores in this run: original; neutral multipliers only; neutral plus category shrink 10; neutral plus no winsor clipping; Huber regression with neutral multipliers; Huber plus shrink 10. Huber uses fixed cutoff 1.345 and MAD scale, not a tuning search.

Five deterministic inner folds use FNV-1a of CoinGecko ID (slug if absent), solely within the 66 outer-training rows. Rows with the same known token ID stay together. Each fold refits its own winsor thresholds, slope, intercept and category adjustments. Candidate ranking uses pooled inner median absolute log error; adoption requires at least a 5% reduction versus original and no increase in mean absolute log error. No outer metric chooses candidates or hyperparameters. `selection.json` was produced before the outer test command; the test command recomputes the identical deterministic training-only selection before scoring only the original and selected candidate.

Selected **unwinsorized-core**. Inner median absolute log error: **1.057346994584898 → 0.9858422487531966** (6.7627% lower); inner mean absolute log error: **1.382183955712823 → 1.3675516966063574**. The complete candidate/fold table is in `selection.json`. This is a small search, not an exhaustive algorithm comparison; learned additional features and category slopes were not tested.

## Exact development-holdout results

Natural-log errors, 29 identical evaluation rows:

| Metric | Before | After |
|---|---:|---:|
| Median absolute log error | 1.1681917628532918 | 1.114480306795116 |
| Mean absolute log error | 1.7372581643090554 | 1.6937700726611682 |
| Within 2× fraction | 0.2413793103448276 | 0.27586206896551724 |
| Within 2× count | 7/29 | 8/29 |
| exp(median absolute log error) | 3.216171776088987 | 3.047983751066054 |

Median error improves 4.5978%. All 29 outer rows have no matching CoinGecko-ID family in the training side under the declared grouping, so the unseen-family diagnostic equals the main result. Missing IDs and related projects using different IDs can still conceal dependencies.

A seeded 5,000-resample paired row bootstrap gives an exploratory 95% percentile interval for the difference in median absolute log error (after minus before) of **[-0.16850201536267662, 0.26284809466821635]**. It crosses zero. The sample is small, fold results vary, and row independence is imperfect; no statistically established improvement is claimed. No further candidate selection followed the outer result.

The built-in flat TVL-multiple baseline on the same test has rounded median absolute log error **1.6667**, within-2× fraction **0.2069**. The revised fitted model is better on these reported measures, but the resulting approximately 3× median error is substantial.

## Verification and reproduction

Node v26.13.0, standard library only, no installed packages required:

```sh
node evaluation/evaluate.ts /path/to/snapshot.json
node evaluation/evaluate.ts /path/to/snapshot.json --test
node evaluation/verify.ts /path/to/snapshot.json
git diff --check
```

The scripts require the original git revision to be present. Node's `stripTypeScriptTypes` emits an experimental API warning when loading the immutable baseline. Editor diagnostics may report missing Node type declarations because this repository has no `@types/node`; runtime execution succeeded.

Actual verification passed: snapshot hash; exact production parameters versus selected candidate; every stored outer prediction through both `predictValue` and `impliedValue`; dashboard OOS evidence; all 178 board rows passing `boardIssue`; neutral factor fields; zero/one/four-comp fallbacks; constant TVL; unseen category fallback; and diff whitespace checks. Outputs are in `verification.json`. Verification re-executes the fixed production predictions for parity, not to choose another model.

## Limitations

- Historically inspected development holdout and six-candidate selection create optimism that requires a new sealed snapshot or prospective evaluation to resolve.
- Listing dates differ from token launch dates; contemporaneous TVL and market caps cannot validate future launch outcomes.
- Token market cap is not protocol enterprise value or FDV. Unknown circulating supply, emissions, revenue, ownership, token utility and market regime remain omitted.
- Multiple protocol records can share an economic token. Grouped inner CV reduces known-ID leakage, but production fits still weight each comp row and family detection is incomplete.
- 33 undated comps are not represented in the outer test, and fitting all 128 production comps changes the training distribution.
- Removing clipping may increase sensitivity to unusual comps on a different snapshot. Neutralizing hand-set factors removes unsupported premiums but does not establish that growth, tenure and breadth have no predictive value.
- Existing dashboard prose was outside this task's edit scope; any hardcoded old formula explanation needs to be checked by its owner. Numeric evidence and factor fields already reflect the revised model.

Only fitting-related defaults/comments/version in `lib/model.ts` and new evaluation artifacts were changed by this task. No submission, push, main entrypoint, dashboard, or farm-plan edits were made.
