// Launch Radar's model: one sealed snapshot in, one ranked board out.
//
// The board ranks protocols that record no token. It covers every slug on the
// snapshot's watchlist (the floor), then adds every pre-token protocol below the
// watchlist floor that passes the same wrapped-product screen the house rule uses,
// judged from the snapshot's ten fields alone. Protocols whose token already
// trades are kept apart and shown with the market's own capitalisation, never
// mixed into the ranking.
//
// Implied value is FITTED, not guessed. The protocols that record a token are
// the calibration comps: their market caps are facts, and the model learns the
// log-linear relation between market cap and TVL from them, at runtime, from
// whatever snapshot it is handed. No protocol name is ever special-cased and no
// fitted number is hardcoded: one function scores every row.
//
//   comps          = protocols with mcap_usd > 0 and tvl_usd > 0
//   log-ratios     = ln(mcap_usd / tvl_usd), winsorized at the 5th/95th percentiles
//   fit            = least squares of ln(mcap) on ln(tvl) over the winsorized comps:
//                    ln(mcap) = intercept + slope x ln(tvl)
//   category adj.  = each category's median residual, shrunk toward 0 with
//                    k = 5 pseudo-counts, so a lone comp cannot swing its category
//   core           = exp(intercept + slope x ln(tvl_usd) + category adjustment)
//   implied        = max(1, round(core x growthFactor x tenureFactor x breadthFactor))
//
// The three adjustments are bounded secondary multipliers, kept at half the
// strength of the first version because the out-of-sample check showed the
// fitted core carries the signal: growthFactor = 1 + 0.20 x clamp(change_7d,
// -50, 200) / 100, tenureFactor = 0.85 + 0.15 x min(age_days, 730) / 730,
// breadthFactor = 1 + 0.025 x min(chains, 10). Age is the time from listed_at
// to the snapshot's as_of date; an unlisted age uses 365 days.
//
// The fit is validated out of sample before it is trusted: the dated comps are
// split by listing date, the model is fitted on the earlier 70% and scored on
// the later 30% (a deterministic slug-hash K-fold when the time split is
// degenerate). The evidence — comp count, fitted slope and intercept, the
// per-category adjustments, the winsor band, and the out-of-sample error —
// travels with the dashboard's data, and the dashboard's Model view renders it.
// A protocol that records no token is described as recording no token, never as
// having none: the record is not proof.

/** One protocol entry: exactly the ten fields the sealed snapshot carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The value model's hyperparameters: the method's settings, never fitted numbers. */
export interface ValueModel {
  shrink_k: number;
  winsor_lo: number;
  winsor_hi: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  tenure_floor: number;
  tenure_range: number;
  tenure_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
  oos_train_share: number;
  oos_min_side: number;
  k_folds: number;
  min_comps: number;
}

export const VALUE_MODEL: ValueModel = {
  shrink_k: 5,
  winsor_lo: 0.05,
  winsor_hi: 0.95,
  growth_weight: 0.2,
  growth_floor: -50,
  growth_cap: 200,
  tenure_floor: 0.85,
  tenure_range: 0.15,
  tenure_days: 730,
  unknown_age_days: 365,
  breadth_per_chain: 0.025,
  breadth_max_chains: 10,
  oos_train_share: 0.7,
  oos_min_side: 10,
  k_folds: 5,
  min_comps: 5,
};

/** The model's version label, shown by the dashboard. */
export const MODEL_VERSION = 'launch-2';

/** How many live-token protocols the Live view carries, by market capitalisation. */
export const LIVE_ROWS = 24;

/** One farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    intercept: number;
    slope: number;
    category_adj: number;
    category_n: number;
    core_value_usd: number;
    growth_pct: number;
    growth_factor: number;
    tenure_factor: number;
    breadth_factor: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** One row as the dashboard reads it, farm plan included. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  core_value_usd: number;
  category_adj: number;
  category_n: number;
  growth_factor: number;
  tenure_factor: number;
  breadth_factor: number;
  on_watchlist: boolean;
  farm_steps: string[];
}

/** A protocol whose token already trades: the market's value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One category's fitted adjustment: its median residual, shrunk toward zero. */
export interface CategoryFit {
  category: string | null;
  n: number;
  adjustment: number;
  median_ratio: number;
}

/** The out-of-sample validation: the fitted pipeline scored on comps it never saw. */
export interface OosResult {
  method: 'time-split' | 'k-fold' | 'none';
  train_n: number;
  test_n: number;
  split_date: string | null;
  med_abs_log_err: number | null;
  within_2x: number | null;
  core_med_abs_log_err: number | null;
  core_within_2x: number | null;
  baseline_med_abs_log_err: number | null;
  baseline_within_2x: number | null;
  reason: string | null;
}

/** The calibration evidence the dashboard's Model view renders. */
export interface Evidence {
  comp_count: number;
  dated_count: number;
  global_median_ratio: number;
  winsor: { lo: number; hi: number };
  fit: { intercept: number; slope: number };
  categories: CategoryFit[];
  oos: OosResult;
  fallback: boolean;
  fallback_reason: string | null;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ValueModel;
  model_version: string;
  evidence: Evidence;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  const end = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

/** Seven-day growth clamped to the model's band; an unreported change counts as flat. */
export function clampedGrowth(change7d: number | null, model: ValueModel): number {
  const raw = typeof change7d === 'number' && Number.isFinite(change7d) ? change7d : 0;
  return Math.min(model.growth_cap, Math.max(model.growth_floor, raw));
}

/** The growth factor: a bounded secondary multiplier, fast growers up to 1.4x, steep fallers 0.9x. */
export function growthFactor(growthPct: number, model: ValueModel): number {
  return 1 + (growthPct / 100) * model.growth_weight;
}

/** The tenure factor: longer with no token earns up to 1.0x, the newest keep 0.85x. */
export function tenureFactor(age: number | null, model: ValueModel): number {
  const days = age ?? model.unknown_age_days;
  const capped = Math.min(Math.max(days, 0), model.tenure_days);
  return model.tenure_floor + (capped / model.tenure_days) * model.tenure_range;
}

/** The breadth factor: each chain up to ten adds 2.5%, for distribution already built. */
export function breadthFactor(chainCount: number, model: ValueModel): number {
  return 1 + Math.min(Math.max(chainCount, 0), model.breadth_max_chains) * model.breadth_per_chain;
}

// ---------------------------------------------------------------- fitting

/** A quantile of sorted numbers, linearly interpolated. */
export function quantileOf(sorted: number[], f: number): number {
  const i = (sorted.length - 1) * f;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
}

/** The median of numbers, NaN when there are none. */
export function medianOf(values: number[]): number {
  if (values.length === 0) return NaN;
  return quantileOf([...values].sort((a, b) => a - b), 0.5);
}

/** FNV-1a hash: the deterministic fold assignment for the K-fold fallback. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A fitted model: the log-linear core, the winsor band, and the shrunk category adjustments. */
export interface FittedModel {
  intercept: number;
  slope: number;
  winsor_lo: number;
  winsor_hi: number;
  global_median_ratio: number;
  categories: CategoryFit[];
  comp_count: number;
  dated_count: number;
  fallback: boolean;
  fallback_reason: string | null;
}

/** Whether a protocol is a calibration comp: a token whose market cap is a recorded fact. */
export function isComp(p: SnapshotProtocol): boolean {
  return typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) && p.mcap_usd > 0 && Number.isFinite(p.tvl_usd) && p.tvl_usd > 0;
}

/** The category adjustment a protocol's category carries, 0 when its category has no comps. */
export function categoryAdjustment(fitted: FittedModel, category: string | null): { adj: number; n: number } {
  const found = fitted.categories.find((c) => c.category === category);
  return found === undefined ? { adj: 0, n: 0 } : { adj: found.adjustment, n: found.n };
}

/**
 * Fit the value model on a set of protocols: the comps among them carry the fit.
 * Least squares of ln(mcap) on ln(tvl) over winsorized log-ratios, then each
 * category's median residual shrunk toward zero. Pure and deterministic.
 */
export function fitModel(protocols: SnapshotProtocol[], model: ValueModel): FittedModel {
  const comps = protocols.filter(isComp);
  const datedCount = comps.filter((p) => p.listed_at !== null && Number.isFinite(Date.parse(`${p.listed_at}T00:00:00Z`))).length;
  if (comps.length < model.min_comps) {
    const ratios = comps.map((p) => p.mcap_usd! / p.tvl_usd);
    const ratio = ratios.length > 0 ? Math.exp(medianOf(ratios.map((r) => Math.log(r)))) : 1;
    return {
      intercept: Math.log(ratio),
      slope: 1,
      winsor_lo: NaN,
      winsor_hi: NaN,
      global_median_ratio: ratio,
      categories: [],
      comp_count: comps.length,
      dated_count: datedCount,
      fallback: true,
      fallback_reason: `only ${comps.length} usable comps: the fit falls back to a flat multiple of TVL, uncalibrated`,
    };
  }
  const logRatios = comps.map((p) => Math.log(p.mcap_usd! / p.tvl_usd));
  const sorted = [...logRatios].sort((a, b) => a - b);
  const lo = quantileOf(sorted, model.winsor_lo);
  const hi = quantileOf(sorted, model.winsor_hi);
  const clamp = (x: number): number => Math.min(hi, Math.max(lo, x));
  const xs = comps.map((p) => Math.log(p.tvl_usd));
  const ys = comps.map((p, i) => Math.log(p.tvl_usd) + clamp(logRatios[i]!));
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i]! - meanX) * (ys[i]! - meanY);
    sxx += (xs[i]! - meanX) * (xs[i]! - meanX);
  }
  const slope = sxx === 0 ? 1 : sxy / sxx;
  const intercept = meanY - slope * meanX;
  const byCategory = new Map<string | null, number[]>();
  const ratioByCategory = new Map<string | null, number[]>();
  for (const p of comps) {
    const residual = Math.log(p.mcap_usd!) - (intercept + slope * Math.log(p.tvl_usd));
    const key = p.category;
    if (!byCategory.has(key)) {
      byCategory.set(key, []);
      ratioByCategory.set(key, []);
    }
    byCategory.get(key)!.push(residual);
    ratioByCategory.get(key)!.push(clamp(Math.log(p.mcap_usd! / p.tvl_usd)));
  }
  const categories: CategoryFit[] = [...byCategory.entries()]
    .map(([category, residuals]) => ({
      category,
      n: residuals.length,
      adjustment: (residuals.length * medianOf(residuals)) / (residuals.length + model.shrink_k),
      median_ratio: Math.exp(medianOf(ratioByCategory.get(category)!)),
    }))
    .sort((a, b) => b.n - a.n || (a.category ?? '').localeCompare(b.category ?? ''));
  return {
    intercept,
    slope,
    winsor_lo: lo,
    winsor_hi: hi,
    global_median_ratio: Math.exp(medianOf(logRatios.map(clamp))),
    categories,
    comp_count: comps.length,
    dated_count: datedCount,
    fallback: false,
    fallback_reason: null,
  };
}

/** The fitted core value of a protocol: exp(intercept + slope x ln(TVL) + category adjustment). */
export function fittedCore(fitted: FittedModel, protocol: SnapshotProtocol): { core: number; adj: number; n: number } {
  const { adj, n } = categoryAdjustment(fitted, protocol.category);
  const core = Math.exp(fitted.intercept + fitted.slope * Math.log(protocol.tvl_usd) + adj);
  return { core, adj, n };
}

/** The full pipeline's prediction for one protocol, as the board scores it. */
export function predictValue(
  fitted: FittedModel,
  protocol: SnapshotProtocol,
  asOf: string,
  model: ValueModel,
  withAdjustments: boolean,
): number {
  const { core } = fittedCore(fitted, protocol);
  let value = core;
  if (withAdjustments) {
    const age = ageDays(asOf, protocol.listed_at);
    value *= growthFactor(clampedGrowth(protocol.change_7d, model), model);
    value *= tenureFactor(age, model);
    value *= breadthFactor(protocol.chains.length, model);
  }
  if (!Number.isFinite(value)) return 1;
  return Math.min(100_000_000_000_000, Math.max(1, Math.round(value)));
}

/** The fitted factors and the implied value one protocol gets. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  fitted: FittedModel,
  model: ValueModel,
): { implied: number; core: number; adj: number; n: number; growthPct: number; growth: number; tenure: number; breadth: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = clampedGrowth(protocol.change_7d, model);
  const growth = growthFactor(growthPct, model);
  const tenure = tenureFactor(age, model);
  const breadth = breadthFactor(protocol.chains.length, model);
  const { core, adj, n } = fittedCore(fitted, protocol);
  const raw = core * growth * tenure * breadth;
  const implied = !Number.isFinite(raw) ? 1 : Math.min(100_000_000_000_000, Math.max(1, Math.round(raw)));
  return { implied, core, adj, n, growthPct, growth, tenure, breadth, age };
}

// ---------------------------------------------------------------- validation

/** Median absolute log-error and share within 2x for predictions against recorded market caps. */
function errorStats(errors: number[]): { med: number; within2x: number } {
  return { med: medianOf(errors), within2x: errors.filter((e) => e <= Math.log(2)).length / errors.length };
}

/**
 * Validate the fitted pipeline out of sample. Time-split first: fit on the
 * earliest-listed 70% of dated comps, score the latest 30%. When the split is
 * degenerate (too few dated comps, or every comp listed the same day), a
 * deterministic slug-hash K-fold instead. The full pipeline, the fitted core
 * alone, and a global-median baseline are all scored, so the report is honest
 * about what the adjustments and the categories add.
 */
export function validateOutOfSample(snapshot: Snapshot, model: ValueModel): OosResult {
  const comps = snapshot.protocols.filter(isComp);
  if (comps.length < model.min_comps) {
    return { method: 'none', train_n: 0, test_n: 0, split_date: null, med_abs_log_err: null, within_2x: null, core_med_abs_log_err: null, core_within_2x: null, baseline_med_abs_log_err: null, baseline_within_2x: null, reason: `only ${comps.length} usable comps: nothing to validate against` };
  }
  const dated = comps
    .filter((p) => p.listed_at !== null && Number.isFinite(Date.parse(`${p.listed_at}T00:00:00Z`)))
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const distinctDates = new Set(dated.map((p) => p.listed_at)).size;
  const trainCount = Math.floor(dated.length * model.oos_train_share);
  if (dated.length >= 2 * model.oos_min_side && trainCount >= model.oos_min_side && dated.length - trainCount >= model.oos_min_side && distinctDates > 1) {
    const train = dated.slice(0, trainCount);
    const test = dated.slice(trainCount);
    const fitted = fitModel(train, model);
    const full: number[] = [];
    const core: number[] = [];
    const base: number[] = [];
    for (const p of test) {
      const actual = Math.log(p.mcap_usd!);
      full.push(Math.abs(Math.log(predictValue(fitted, p, snapshot.as_of, model, true)) - actual));
      core.push(Math.abs(Math.log(predictValue(fitted, p, snapshot.as_of, model, false)) - actual));
      base.push(Math.abs(Math.log(Math.max(1, Math.round(p.tvl_usd * fitted.global_median_ratio))) - actual));
    }
    const f = errorStats(full);
    const c = errorStats(core);
    const b = errorStats(base);
    return {
      method: 'time-split',
      train_n: train.length,
      test_n: test.length,
      split_date: train[train.length - 1]!.listed_at,
      med_abs_log_err: round4(f.med),
      within_2x: round4(f.within2x),
      core_med_abs_log_err: round4(c.med),
      core_within_2x: round4(c.within2x),
      baseline_med_abs_log_err: round4(b.med),
      baseline_within_2x: round4(b.within2x),
      reason: null,
    };
  }
  const folds: SnapshotProtocol[][] = Array.from({ length: model.k_folds }, () => []);
  for (const p of comps) folds[fnv1a(p.slug) % model.k_folds]!.push(p);
  const full: number[] = [];
  const core: number[] = [];
  const base: number[] = [];
  let trainTotal = 0;
  let testTotal = 0;
  for (let k = 0; k < model.k_folds; k++) {
    const test = folds[k]!;
    const train = folds.flatMap((f, i) => (i === k ? [] : f));
    if (test.length === 0 || train.length < model.min_comps) continue;
    const fitted = fitModel(train, model);
    trainTotal += train.length;
    testTotal += test.length;
    for (const p of test) {
      const actual = Math.log(p.mcap_usd!);
      full.push(Math.abs(Math.log(predictValue(fitted, p, snapshot.as_of, model, true)) - actual));
      core.push(Math.abs(Math.log(predictValue(fitted, p, snapshot.as_of, model, false)) - actual));
      base.push(Math.abs(Math.log(Math.max(1, Math.round(p.tvl_usd * fitted.global_median_ratio))) - actual));
    }
  }
  if (testTotal === 0) {
    return { method: 'none', train_n: 0, test_n: 0, split_date: null, med_abs_log_err: null, within_2x: null, core_med_abs_log_err: null, core_within_2x: null, baseline_med_abs_log_err: null, baseline_within_2x: null, reason: 'the K-fold fallback found no test fold: nothing to validate against' };
  }
  const f = errorStats(full);
  const c = errorStats(core);
  const b = errorStats(base);
  return {
    method: 'k-fold',
    train_n: trainTotal,
    test_n: testTotal,
    split_date: null,
    med_abs_log_err: round4(f.med),
    within_2x: round4(f.within2x),
    core_med_abs_log_err: round4(c.med),
    core_within_2x: round4(c.within2x),
    baseline_med_abs_log_err: round4(b.med),
    baseline_within_2x: round4(b.within2x),
    reason: `the time split was degenerate (${dated.length} dated comps, ${distinctDates} distinct listing dates), so a deterministic ${model.k_folds}-fold split by slug hash stands in`,
  };
}

/** Whether the record shows no token at all: no market cap, no CoinGecko id, no symbol. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/**
 * Whether a protocol passes the wrapped-product screen: the same checks the
 * watchlist rule applies, judged from the snapshot's ten fields. The house rule
 * also reads a parent protocol the snapshot does not carry, so above the floor
 * the board trusts the watchlist itself and applies this screen only below it.
 */
export function passesWrappedScreen(p: SnapshotProtocol): boolean {
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return false;
  if (VERSION_MARKER.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_NAMES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, fitted: FittedModel, model: ValueModel = VALUE_MODEL): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && p.tvl_usd < snapshot.floor_usd && recordsNoToken(p) && passesWrappedScreen(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, ...impliedValue(p, snapshot.as_of, fitted, model) }));
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      intercept: fitted.intercept,
      slope: fitted.slope,
      category_adj: s.adj,
      category_n: s.n,
      core_value_usd: Math.max(1, Math.round(s.core)),
      growth_pct: s.growthPct,
      growth_factor: round4(s.growth),
      tenure_factor: round4(s.tenure),
      breadth_factor: round4(s.breadth),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and re-check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase when it names none. */
function firstChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The capital one farm position needs, tiered by the protocol's own TVL. */
function capitalTier(tvlUsd: number): number {
  if (tvlUsd >= 2_000_000_000) return 200;
  if (tvlUsd >= 500_000_000) return 120;
  if (tvlUsd >= 100_000_000) return 75;
  return 40;
}

const CHEAP_GAS_CHAINS = new Set([
  'Solana', 'Tron', 'Binance', 'Polygon', 'Arbitrum', 'Optimism', 'Base', 'Avalanche',
  'Linea', 'Scroll', 'Gnosis', 'Blast', 'Monad', 'Hyperliquid L1', 'Berachain', 'Sonic',
  'Unichain', 'Sei', 'Sui', 'Aptos', 'Near', 'Fantom', 'Celo', 'Kaia', 'Fraxtal', 'Morph',
]);

/** Gas estimates for the protocol's first chain: Ethereum costs real money, cheap chains cost cents. */
function gasTier(chain: string): { setup: string; weekly: string } {
  if (chain === 'Ethereum') return { setup: 'about $12 of gas', weekly: 'about $4 of gas a week' };
  if (chain === 'Bitcoin') return { setup: 'about $3 of network fees', weekly: 'about $1 of network fees a week' };
  if (CHEAP_GAS_CHAINS.has(chain)) return { setup: 'under $1 of gas', weekly: 'a few cents of gas a week' };
  return { setup: 'about $3 of gas', weekly: 'about $1 of gas a week' };
}

/** How long to hold, from the protocol's age: younger protocols get a longer window. */
function holdTier(age: number | null): number {
  if (age === null) return 60;
  if (age < 90) return 90;
  if (age < 365) return 60;
  return 45;
}

/** The category's entry action, in words a farmer can follow. */
function entryAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('uncollateralized') || c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow $10 against it and repay the loan the same week.`;
  }
  if (c.includes('dex')) return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and leave the position in range.`;
  if (c.includes('yield') || c.includes('leveraged farm') || c.includes('farm')) return `Deposit $${capital} into ${name}'s highest-TVL vault on ${chain} and keep the receipt tokens.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC through ${name} onto ${chain}, then use the bridged funds inside its own app.`;
  if (c.includes('restak') || c.includes('staking') || c.includes('anchor btc')) return `Stake $${capital} through ${name} on ${chain} and hold the receipt token in the same wallet.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in the farming wallet.`;
  if (c.includes('stablecoin') || c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold the balance.`;
  if (c.includes('prediction')) return `Fund the account with $${capital} and place one position on ${name}'s nearest-resolving market.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('index')) return `Buy $${capital} of ${name}'s index token on ${chain} and hold it.`;
  if (c.includes('payment')) return `Load $${capital} through ${name} on ${chain} and route one real payment from the wallet.`;
  if (c.includes('privacy')) return `Make one shielded deposit of $${capital} through ${name} on ${chain} and keep the proof.`;
  if (c.includes('governance')) return `Stake $${capital} through ${name} and cast one vote in its current proposal.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} curated vault on ${chain} and keep the shares.`;
  if (c.includes('liquidity manager')) return `Deposit $${capital} into ${name}'s managed range on ${chain} and let it rebalance.`;
  if (c.includes('basis')) return `Deposit $${capital} into ${name}'s basis vault on ${chain} and hold the shares.`;
  if (c.includes('chain')) return `Bridge $${capital} to ${name}'s chain and use its flagship app once from the farming wallet.`;
  if (c.includes('otc')) return `Complete one $${capital} trade on ${name} and keep the settlement record.`;
  if (c.includes('card')) return `Order ${name}'s card, load $${capital}, and make one purchase with it.`;
  if (c.includes('cede')) return `Deposit $${capital} into ${name}'s vault on ${chain} and keep the position open.`;
  if (c.includes('decentralized btc')) return `Mint $${capital} of ${name}'s BTC-backed asset on ${chain} and hold it.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The recurring weekly action, flavoured by category so the plan is not one-size-fits-all. */
function weeklyAction(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Adjust the ${name} position once a week: add $5 of supply or repay part of the borrow.`;
  if (c.includes('dex')) return `Collect the week's fees on ${name}, then re-add them to the same pool on ${chain}.`;
  if (c.includes('yield') || c.includes('farm') || c.includes('curator') || c.includes('allocator')) return `Check ${name}'s vault page weekly and compound or top up $5 when the yield posts.`;
  if (c.includes('bridge')) return `Bridge a further $5 through ${name} each week so the wallet shows repeat crossings.`;
  if (c.includes('restak') || c.includes('staking')) return `Restake the week's rewards through ${name} so the staked balance keeps growing.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Open and close one small position a week on ${name} to keep the account active.`;
  if (c.includes('governance')) return `Vote in every new ${name} proposal, even a routine one, from the farming wallet.`;
  if (c.includes('prediction')) return `Place one small position a week on ${name}'s markets that resolve soonest.`;
  return `Make one qualifying action a week on ${name}: a deposit, a swap, a claim or a vote.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time,
 * derived from the protocol's own record (category, chains, TVL, age).
 * No airdrop is promised: the plan says what to do, what it costs, and how
 * long it takes, and the protocol records no token.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = firstChain(p);
  const capital = capitalTier(p.tvl_usd);
  const gas = gasTier(chain);
  const hold = holdTier(age);
  const second = p.chains.length > 1 ? ` If ${p.name} also runs on ${p.chains[1]!}, repeat a smaller $${Math.max(10, Math.round(capital / 4))} position there.` : '';
  return [
    {
      text: `Open a fresh wallet that holds only the funds you plan to farm, write its seed phrase on paper, and send a $1 test transaction first.`,
      cost: `${gas.setup} for the test`,
      time: '10 minutes',
    },
    {
      text: entryAction(p, capital, chain),
      cost: `$${capital} of capital and ${gas.setup}`,
      time: '20 minutes to set up',
    },
    {
      text: weeklyAction(p, chain),
      cost: gas.weekly,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity lands in more than one snapshot.${second}`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before withdrawing, open the points or rewards page linked from ${p.name}'s own app and confirm the wallet's activity is counted; never pay anyone to claim.`,
      cost: 'nothing to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Log the wallet address, every transaction hash and the dates in a farm note, and plan the exit: unwind in two halves a day apart to check slippage.`,
      cost: 'nothing but the log',
      time: '10 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !recordsNoToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, LIVE_ROWS)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
}

/** Everything the dashboard renders, from the snapshot: the fit first, then the board it scores. */
export function buildRadar(snapshot: Snapshot, model: ValueModel = VALUE_MODEL): { board: BoardRow[]; radar: RadarData; fitted: FittedModel } {
  const fitted = fitModel(snapshot.protocols, model);
  const oos = validateOutOfSample(snapshot, model);
  const board = buildBoard(snapshot, fitted, model);
  const live = liveRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const evidence: Evidence = {
    comp_count: fitted.comp_count,
    dated_count: fitted.dated_count,
    global_median_ratio: fitted.global_median_ratio,
    winsor: { lo: fitted.winsor_lo, hi: fitted.winsor_hi },
    fit: { intercept: fitted.intercept, slope: fitted.slope },
    categories: fitted.categories,
    oos,
    fallback: fitted.fallback,
    fallback_reason: fitted.fallback_reason,
  };
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    evidence,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !watchlist.has(r.slug)).length,
    live_size: live.length,
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      listed_at: r.listed_at,
      age_days: r.age_days,
      implied_value_usd: r.implied_value_usd,
      core_value_usd: r.model.core_value_usd,
      category_adj: r.model.category_adj,
      category_n: r.model.category_n,
      growth_factor: r.model.growth_factor,
      tenure_factor: r.model.tenure_factor,
      breadth_factor: r.model.breadth_factor,
      on_watchlist: watchlist.has(r.slug),
      farm_steps: r.farm_steps,
    })),
    live,
  };
  return { board, radar, fitted };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const len = s.trim().length;
      if (len < 20 || len > 600) return `${r.slug} has a farm step of ${len} characters`;
    }
  }
  return null;
}

/** The dashboard's dataset as one script: window.RADAR, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
