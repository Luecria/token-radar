// Reproduce selection using only the original training partition, then audit the reused holdout.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { VALUE_MODEL, parseSnapshot, isComp, fnv1a, fitModel, predictValue, medianOf } from '../lib/model.ts';
const input = process.argv[2];
if (!input) throw new Error('Usage: node scripts/evaluate.ts snapshot.json [report.json]');
const bytes = readFileSync(input);
const snapshot = parseSnapshot(bytes.toString());
const original = { ...VALUE_MODEL, robust: false, shrink_k: 5, winsor_lo: 0.05, winsor_hi: 0.95 };
const dated = snapshot.protocols.filter(isComp).filter(p => p.listed_at !== null && Number.isFinite(Date.parse(`${p.listed_at}T00:00:00Z`)))
  .sort((a,b) => a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
const cut = Math.floor(dated.length * original.oos_train_share);
const train = dated.slice(0, cut), test = dated.slice(cut);
if (train.length < 10 || test.length < 10) throw new Error('This audit requires the original time split.');
function stats(errors: number[]) {
  const median = medianOf(errors);
  return { n: errors.length, median_abs_log_error: median, median_miss_multiple: Math.exp(median), mean_abs_log_error: errors.reduce((a,b)=>a+b,0)/errors.length, within_2x_count: errors.filter(e=>e<=Math.log(2)).length, within_2x: errors.filter(e=>e<=Math.log(2)).length/errors.length };
}
function fitCandidate(protocols, model) {
  const fitted = fitModel(protocols, model);
  if (!model.robust) return fitted;
  const comps = protocols.filter(isComp);
  const xs = comps.map(p=>Math.log(p.tvl_usd));
  const ys = comps.map(p=>Math.log(p.mcap_usd));
  // Theil-Sen median pairwise slope: one extreme ratio cannot dominate the slope.
  const slopes = [];
  for(let i=0;i<xs.length;i++) for(let j=i+1;j<xs.length;j++) if(xs[i]!==xs[j]) slopes.push((ys[j]-ys[i])/(xs[j]-xs[i]));
  fitted.slope = medianOf(slopes);
  fitted.intercept = medianOf(ys.map((y,i)=>y-fitted.slope*xs[i]));
  fitted.categories = fitted.categories.map(c=>{
    const residuals = comps.filter(p=>p.category===c.category).map(p=>Math.log(p.mcap_usd)-fitted.intercept-fitted.slope*Math.log(p.tvl_usd));
    return {...c,adjustment:c.n*medianOf(residuals)/(c.n+model.shrink_k)};
  });
  return fitted;
}
function cv(model: typeof original) {
  const errors: number[] = [];
  for (let fold=0; fold<5; fold++) {
    const fitted = fitCandidate(train.filter(p=>fnv1a(p.slug)%5!==fold),model);
    for (const p of train.filter(p=>fnv1a(p.slug)%5===fold)) errors.push(Math.abs(Math.log(predictValue(fitted,p,snapshot.as_of,model,true)/p.mcap_usd!)));
  }
  return stats(errors);
}
const candidates = [];
for (const shrink_k of [0,1,2,5,10,20,50]) for (const winsor_lo of [0,0.05,0.1]) {
  const model = { ...original, shrink_k, winsor_lo, winsor_hi: 1-winsor_lo };
  candidates.push({model, cv:cv(model)});
}
for (const shrink_k of [0,1,2,5,10,20,50]) {
  const model = {...original, shrink_k, robust:true};
  candidates.push({model, cv:cv(model)});
}
// MAE in log space uses every validation row, avoiding a noisy median-only selection.
candidates.sort((a,b)=>a.cv.mean_abs_log_error-b.cv.mean_abs_log_error || a.model.shrink_k-b.model.shrink_k || a.model.winsor_lo-b.model.winsor_lo);
const selected = candidates[0].model;
function holdout(model: typeof original) {
  const fitted=fitCandidate(train,model);
  const rows=test.map(p=>({slug:p.slug,actual:p.mcap_usd!,prediction:predictValue(fitted,p,snapshot.as_of,model,true),baseline:Math.max(1,Math.round(p.tvl_usd*fitted.global_median_ratio))}));
  return { full:stats(rows.map(r=>Math.abs(Math.log(r.prediction/r.actual)))),baseline:stats(rows.map(r=>Math.abs(Math.log(r.baseline/r.actual)))),rows };
}
const report={ snapshot_sha256:createHash('sha256').update(bytes).digest('hex'), reference_commit:'d88e92297affb609799799b2923b5e115f078b77', caveat:'Reused previously inspected holdout, not a fresh prospective test. Candidate selection uses training-only hash 5-fold mean absolute log error. Cross-sectional current caps split by listing date are not historical launch backtests; category/token-family dependencies can remain.', train_slugs:train.map(p=>p.slug),test_slugs:test.map(p=>p.slug),split_date:train.at(-1)!.listed_at, candidates, selected, before:holdout(original),after:holdout(selected) };
const text=JSON.stringify(report,null,2)+'\n';
if(process.argv[3]) writeFileSync(process.argv[3],text);
console.log(JSON.stringify({selected,cv_before:cv(original),cv_after:candidates[0].cv,before:report.before.full,after:report.after.full,baseline:report.before.baseline},null,2));
