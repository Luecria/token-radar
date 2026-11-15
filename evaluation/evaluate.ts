import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
import assert from 'node:assert/strict';
import type { SnapshotProtocol, FittedModel, ValueModel } from '../lib/model.ts';

// This immutable baseline is the original implementation, not a reconstructed approximation.
const revision = 'd88e92297affb609799799b2923b5e115f078b77';
const source = execFileSync('git', ['show', `${revision}:lib/model.ts`], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
const baseline = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`);
const input = process.argv[2] ?? '/data/data/com.termux/files/home/work/token-radar-01-kit/input/snapshot.json';
const text = readFileSync(input, 'utf8');
const snapshot = baseline.parseSnapshot(text);
const comps: SnapshotProtocol[] = snapshot.protocols.filter(baseline.isComp);
const dated = comps.filter(p => p.listed_at !== null && Number.isFinite(Date.parse(`${p.listed_at}T00:00:00Z`)))
  .sort((a,b) => a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
const trainN = Math.floor(dated.length * baseline.VALUE_MODEL.oos_train_share);
assert.ok(trainN >= 10 && dated.length-trainN >= 10, 'This experiment requires the historical time split');
const train = dated.slice(0, trainN), test = dated.slice(trainN);
const family = (p: SnapshotProtocol) => p.gecko_id ? `gecko:${p.gecko_id}` : `slug:${p.slug}`;
const median = baseline.medianOf as (xs: number[]) => number;
const stats = (errors: number[]) => ({ n: errors.length, median_abs_log_error: median(errors), mean_abs_log_error: errors.reduce((s,x)=>s+x,0)/errors.length, within_2x: errors.filter(x=>x<=Math.log(2)).length/errors.length, median_error_factor: Math.exp(median(errors)) });

// Small, declared candidate set. Robust regression uses a fixed conventional Huber
// cutoff, not a search over tuning constants. No holdout metric enters selection.
export function robustFit(rows: SnapshotProtocol[], model: ValueModel): FittedModel {
  const fitted: FittedModel = baseline.fitModel(rows, model);
  const usable = rows.filter(baseline.isComp);
  if (fitted.fallback) return fitted;
  const xs = usable.map(p=>Math.log(p.tvl_usd));
  const ys = usable.map(p=>Math.log(p.mcap_usd!));
  let a = fitted.intercept, b = fitted.slope;
  for (let iteration=0;iteration<50;iteration++) {
    const residuals = xs.map((x,i)=>ys[i]-a-b*x);
    const center = median(residuals);
    const scale = Math.max(1e-6,1.4826*median(residuals.map(r=>Math.abs(r-center))));
    const weights = residuals.map(r=>Math.min(1,1.345*scale/Math.max(Math.abs(r),1e-12)));
    const total = weights.reduce((s,w)=>s+w,0);
    const mx = xs.reduce((s,x,i)=>s+x*weights[i],0)/total;
    const my = ys.reduce((s,y,i)=>s+y*weights[i],0)/total;
    const xx = xs.reduce((s,x,i)=>s+weights[i]*(x-mx)**2,0);
    const nextB = xx>1e-12 ? xs.reduce((s,x,i)=>s+weights[i]*(x-mx)*(ys[i]-my),0)/xx : 1;
    const nextA = my-nextB*mx;
    const delta = Math.abs(nextA-a)+Math.abs(nextB-b);
    a=nextA;b=nextB;
    if(delta<1e-8) break;
  }
  return {...fitted,intercept:a,slope:b,categories:fitted.categories.map(c=>{
    const errors=usable.filter(p=>p.category===c.category).map(p=>Math.log(p.mcap_usd!)-a-b*Math.log(p.tvl_usd));
    return {...c,adjustment:errors.length*median(errors)/(errors.length+model.shrink_k)};
  })};
}
type Candidate = { id: string; robust: boolean; model: ValueModel };
const original = {...baseline.VALUE_MODEL};
const neutral = {...original,growth_weight:0,tenure_floor:1,tenure_range:0,breadth_per_chain:0};
const candidates: Candidate[] = [
  {id:'original',robust:false,model:original},
  {id:'core-only',robust:false,model:neutral},
  {id:'core-shrink-10',robust:false,model:{...neutral,shrink_k:10}},
  {id:'unwinsorized-core',robust:false,model:{...neutral,winsor_lo:0,winsor_hi:1}},
  {id:'huber-core',robust:true,model:neutral},
  {id:'huber-core-shrink-10',robust:true,model:{...neutral,shrink_k:10}},
];
const fit = (rows: SnapshotProtocol[], c: Candidate) => c.robust ? robustFit(rows,c.model) : baseline.fitModel(rows,c.model);
const predict = (f: FittedModel,p: SnapshotProtocol,c: Candidate) => baseline.predictValue(f,p,snapshot.as_of,c.model,true);
// Family groups keep repeated market caps attached to the same known token in one
// inner fold. Missing gecko ids are unique slugs; no speculative name matching.
const folds = Array.from({length:5},(_,k)=>{
  const valid = train.filter(p=>baseline.fnv1a(family(p))%5===k);
  const training = train.filter(p=>baseline.fnv1a(family(p))%5!==k);
  assert.ok(valid.length>0 && training.length>=original.min_comps);
  assert.equal(training.some(p=>new Set(valid.map(family)).has(family(p))),false);
  return {training,valid};
});
const cv = candidates.map(c=>{
  const errors: number[]=[];
  const perFold=folds.map(({training,valid})=>{
    const fitted=fit(training,c);
    const e=valid.map(p=>Math.abs(Math.log(predict(fitted,p,c))-Math.log(p.mcap_usd!)));
    errors.push(...e);
    return stats(e);
  });
  return {id:c.id,...stats(errors),folds:perFold};
});
const baseCV=cv[0];
const ranked=[...cv].sort((a,b)=>a.median_abs_log_error-b.median_abs_log_error || a.mean_abs_log_error-b.mean_abs_log_error);
// Require a material primary-metric improvement without worsening the mean.
const eligible=ranked.find(c=>c.id!=='original' && c.median_abs_log_error<=baseCV.median_abs_log_error*0.95 && c.mean_abs_log_error<=baseCV.mean_abs_log_error);
const selected=candidates.find(c=>c.id===(eligible?.id??'original'))!;
const selection={rule:'lowest pooled inner-CV median absolute log error, at least 5% below original and mean absolute log error no worse; otherwise retain original',selected:selected.id,parameters:selected.model,robust:selected.robust,cv};
const out = new URL('./selection.json',import.meta.url);
writeFileSync(out,JSON.stringify(selection,null,2)+'\n');
console.log(JSON.stringify(selection,null,2));
if (!process.argv.includes('--test')) process.exit(0);
// Only original and the already-selected candidate see outer labels here.
const beforeFit=fit(train,candidates[0]), afterFit=fit(train,selected);
const predictions=test.map(p=>({slug:p.slug,family:family(p),actual:p.mcap_usd!,before:predict(beforeFit,p,candidates[0]),after:predict(afterFit,p,selected),seen_family:train.some(t=>family(t)===family(p))}));
const errors=(key:'before'|'after',rows=predictions)=>rows.map(p=>Math.abs(Math.log(p[key])-Math.log(p.actual)));
const report={baseline_revision:revision,snapshot_sha256:createHash('sha256').update(text).digest('hex'),as_of:snapshot.as_of,disclosure:'Development holdout: historically inspected. Same-snapshot listing-date split is not a forward market backtest. Candidate selection in this run uses training-only grouped CV; holdout is scored only after selection.',split:{method:'unchanged chronological 70/30 of dated comps; date then slug',train_n:train.length,test_n:test.length,undated_excluded:comps.length-dated.length,cutoff:train.at(-1)!.listed_at,train_slugs:train.map(p=>p.slug),test_slugs:test.map(p=>p.slug)},selection,before:stats(errors('before')),after:stats(errors('after')),unseen_family_diagnostic:{n:predictions.filter(p=>!p.seen_family).length,before:stats(errors('before',predictions.filter(p=>!p.seen_family))),after:stats(errors('after',predictions.filter(p=>!p.seen_family)))},predictions};
writeFileSync(new URL('./results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({before:report.before,after:report.after,unseen_family_diagnostic:report.unseen_family_diagnostic},null,2));
