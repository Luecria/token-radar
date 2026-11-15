import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as model from '../lib/model.ts';
const report=JSON.parse(readFileSync(new URL('./results.json',import.meta.url),'utf8'));
const text=readFileSync(process.argv[2]??'/data/data/com.termux/files/home/work/token-radar-01-kit/input/snapshot.json','utf8');
assert.equal(createHash('sha256').update(text).digest('hex'),report.snapshot_sha256);
const snapshot=model.parseSnapshot(text);
assert.deepEqual(model.VALUE_MODEL,report.selection.parameters);
const training=snapshot.protocols.filter(p=>report.split.train_slugs.includes(p.slug));
const fitted=model.fitModel(training,model.VALUE_MODEL);
for (const row of report.predictions) {
  const p=snapshot.protocols.find(p=>p.slug===row.slug)!;
  assert.equal(model.predictValue(fitted,p,snapshot.as_of,model.VALUE_MODEL,true),row.after);
  assert.equal(model.impliedValue(p,snapshot.as_of,fitted,model.VALUE_MODEL).implied,row.after);
}
const {board,radar}=model.buildRadar(snapshot);
assert.equal(model.boardIssue(board,snapshot),null);
assert.equal(radar.evidence.oos.med_abs_log_err,Math.round(report.after.median_abs_log_error*1e4)/1e4);
assert.equal(radar.evidence.oos.within_2x,Math.round(report.after.within_2x*1e4)/1e4);
assert.ok(board.every(r=>r.model.growth_factor===1 && r.model.tenure_factor===1 && r.model.breadth_factor===1));
for(const rows of [[],training.slice(0,1),training.slice(0,4)]) {
  const fallback=model.fitModel(rows,model.VALUE_MODEL);
  assert.equal(fallback.fallback,true);
  assert.ok(Number.isFinite(model.predictValue(fallback,training[0],snapshot.as_of,model.VALUE_MODEL,true)));
}
const constant=training.map(p=>({...p,tvl_usd:100}));
assert.ok(Number.isFinite(model.fitModel(constant,model.VALUE_MODEL).intercept));
assert.equal(model.categoryAdjustment(fitted,'__unseen_category__').adj,0);
// A seeded paired bootstrap is uncertainty description only; it does not select a model.
let seed=123456789;
const random=()=>{seed=(Math.imul(seed,1664525)+(1013900000 + 4223))>>>0;return seed/4294967296;};
const deltas:number[]=[];
for(let b=0;b<5000;b++) {
  const sample=Array.from({length:report.predictions.length},()=>report.predictions[Math.floor(random()*report.predictions.length)]);
  const error=(key:string)=>model.medianOf(sample.map(p=>Math.abs(Math.log(p[key])-Math.log(p.actual))));
  deltas.push(error('after')-error('before'));
}
deltas.sort((a,b)=>a-b);
const verification={checks:'snapshot hash, exact selected parameters, all saved holdout predictions, both prediction interfaces, full board gate, dashboard OOS evidence, neutral factors, sparse fallback, constant TVL, unseen category',board_rows:board.length,oos:radar.evidence.oos,paired_bootstrap:{resamples:5000,seed:123456789,median_log_error_difference_after_minus_before_95pct:[model.quantileOf(deltas,.025),model.quantileOf(deltas,.975)],caution:'Row bootstrap assumes independent observations; exploratory uncertainty on a historically inspected development holdout, not confirmatory inference.'}};
writeFileSync(new URL('./verification.json',import.meta.url),JSON.stringify(verification,null,2)+'\n');
console.log(JSON.stringify(verification,null,2));
