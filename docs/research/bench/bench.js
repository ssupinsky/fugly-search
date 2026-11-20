const {performance}=require('perf_hooks'); const E=require('./engine'); const gen=require('./corpus');
const {Worker,isMainThread,parentPort,workerData}=require('worker_threads');
const med=a=>{a=[...a].sort((x,y)=>x-y);return a[a.length>>1];};
function time(f,reps=7){const t=[];let r;for(let i=0;i<reps;i++){const s=performance.now();r=f();t.push(performance.now()-s);}return [med(t),Math.min(...t),r];}
function run(label,post){
  const N=1e6; let s=performance.now(); const lines=gen(N); const tg=performance.now()-s;
  global.gc&&global.gc(); const m0=process.memoryUsage();
  s=performance.now(); const S=E.build(lines); const tb=performance.now()-s;
  const lowerLines=lines.map(l=>l.toLowerCase());
  global.gc&&global.gc(); const m1=process.memoryUsage();
  const out=[]; const log=x=>out.push(x);
  log(`[${label}] node ${process.version} ${require('os').cpus()[0].model} gen=${tg.toFixed(0)}ms build(typed-array store+lower+mask)=${tb.toFixed(0)}ms lines=${S.n} textBytes=${(S.bytes/1e6).toFixed(1)}MB`);
  log(`  store memory: arrayBuffers=${((m1.arrayBuffers)/1e6).toFixed(0)}MB rss=${(m1.rss/1e6).toFixed(0)}MB (JS-string lines alternative heapUsed delta incl. strings=${((m1.heapUsed-m0.heapUsed)/1e6).toFixed(0)}MB)`);
  const qs=[['value'],['authtoken'],['xzzzz'],['x1'],['auth','token'],['auth','token','refresh'],['const','return'],['const','value','data'],['ser','con','res'],['au']];
  const rows=[];
  for(const q of qs){
    const [a,amin,r]=time(()=>E.searchA(S,q,null)); const [b]=time(()=>E.searchB(lowerLines,q),3); const [c]=time(()=>E.searchC(S,q),3); const [d]=time(()=>E.searchD(S,q,null),7);
    rows.push(`  ${q.join('+').padEnd(20)} matches=${String(r.count).padStart(7)} A(anchor indexOf+score)=${a.toFixed(1)}ms(min ${amin.toFixed(1)}) B(naive JS strings)=${b.toFixed(1)}ms C(mask+scan,no score)=${c.toFixed(1)}ms D(mask+scan+score)=${d.toFixed(1)}ms`);
  }
  out.push(...rows);
  // incremental typing: "auth token refresh"
  const typing=[['a'],['au'],['aut'],['auth'],['auth','t'],['auth','to'],['auth','tok'],['auth','toke'],['auth','token'],['auth','token','r'],['auth','token','re'],['auth','token','ref']];
  let prev=null; const inc=[],full=[];
  for(const q of typing){ let t=performance.now(); const r=E.searchD(S,q,prev); inc.push([q.join(' '),performance.now()-t,r.count]); prev=r.cand; t=performance.now(); E.searchD(S,q,null); full.push(performance.now()-t); }
  out.push('  incremental typing (query: ms incremental / ms full-rescan / matches):');
  inc.forEach((x,i)=>out.push(`    "${x[0]}": ${x[1].toFixed(1)} / ${full[i].toFixed(1)} / ${x[2]}`));
  return out;
}
if(isMainThread){
  console.log(run('main').join('\n'));
  const w=new Worker(__filename,{workerData:1});
  w.on('message',m=>{console.log(m)}); w.on('exit',()=>process.exit(0));
} else { parentPort.postMessage(run('worker').join('\n')); }
