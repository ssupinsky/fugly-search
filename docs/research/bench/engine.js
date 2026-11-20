'use strict';
// Line store + search engine prototype
const LOWER = new Uint8Array(256); for (let i=0;i<256;i++) LOWER[i]=(i>=65&&i<=90)?i+32:i;
function build(lines){ // lines: array of strings -> store
  let total=0; const bufs=lines.map(l=>Buffer.from(l,'utf8')); for(const b of bufs) total+=b.length+1;
  const text=new Uint8Array(total), lower=new Uint8Array(total);
  const off=new Uint32Array(lines.length), len=new Uint16Array(lines.length), mask=new Uint32Array(lines.length);
  let p=0;
  for(let i=0;i<bufs.length;i++){const b=bufs[i]; off[i]=p; len[i]=Math.min(b.length,65535); let m=0;
    for(let j=0;j<b.length;j++){const c=b[j]; text[p+j]=c; const l=LOWER[c]; lower[p+j]=l; m|=maskBit(l);} text[p+b.length]=10; lower[p+b.length]=10; p+=b.length+1; mask[i]=m;}
  return {text,lower,off,len,mask,n:lines.length,lowerBuf:Buffer.from(lower.buffer),bytes:total};
}
function maskBit(l){ if(l>=97&&l<=122) return 1<<(l-97); if(l>=48&&l<=57) return 1<<26; if(l===95||l===45) return 1<<27; if(l===46) return 1<<28; return 0;}
function qmaskOf(terms){let m=0;for(const t of terms)for(let i=0;i<t.length;i++)m|=maskBit(t.charCodeAt(i));return m;}
function lineOf(off,n,pos){let lo=0,hi=n-1;while(lo<hi){const mid=(lo+hi+1)>>1;if(off[mid]<=pos)lo=mid;else hi=mid-1;}return lo;}
function findIn(lower,needle,from,to){ // needle: Uint8Array
  const n=needle.length,f=needle[0],end=to-n;
  outer: for(let i=from;i<=end;i++){ if(lower[i]!==f)continue; for(let k=1;k<n;k++) if(lower[i+k]!==needle[k]) continue outer; return i;} return -1;}
const isB=c=>!((c>=97&&c<=122)||(c>=48&&c<=57));
function scoreLine(S,li,needles){
  const lower=S.lower,text=S.text,s0=S.off[li],e0=s0+S.len[li];
  let total=0,minS=1e9,maxE=0,ordered=true,prevP=-1;
  for(const nd of needles){ let best=-1,bestP=-1,from=s0,cnt=0;
    while(cnt++<8){const p=findIn(lower,nd,from,e0); if(p<0)break; let s=10*nd.length;
      const pc=p>s0?lower[p-1]:32; if(isB(pc)) s+=30; else if(text[p]>=65&&text[p]<=90&&text[p-1]>=97) s+=25;
      const ec=p+nd.length<e0?lower[p+nd.length]:32; if(isB(ec)) s+=10;
      if(s>best){best=s;bestP=p;} from=p+1;}
    if(best<0) return 0; total+=best; if(bestP<prevP)ordered=false; prevP=bestP; if(bestP<minS)minS=bestP; if(bestP+nd.length>maxE)maxE=bestP+nd.length;}
  if(ordered) total+=15; const span=maxE-minS; total+=Math.max(0,60-span)*0.5; total-=0.1*Math.min(S.len[li],300);
  return total;
}
class TopK{constructor(k){this.k=k;this.ids=new Int32Array(k);this.sc=new Float64Array(k);this.n=0;}
  push(id,s){ if(this.n<this.k){let i=this.n++;while(i>0&&this.sc[i-1]<s){this.sc[i]=this.sc[i-1];this.ids[i]=this.ids[i-1];i--;}this.sc[i]=s;this.ids[i]=id;}
    else if(s>this.sc[this.k-1]){let i=this.k-1;while(i>0&&this.sc[i-1]<s){this.sc[i]=this.sc[i-1];this.ids[i]=this.ids[i-1];i--;}this.sc[i]=s;this.ids[i]=id;}}}
// strategy A: indexOf anchor scan on whole buffer; prev = candidate Int32Array or null
function searchA(S,terms,prev,K=200,ctrl,myId){
  const needles=terms.map(t=>Uint8Array.from(Buffer.from(t))); const anchor=terms.reduce((a,b)=>b.length>a.length?b:a);
  const aN=Uint8Array.from(Buffer.from(anchor)); const cand=[]; const top=new TopK(K); const qm=qmaskOf(terms);
  const consider=(li)=>{ if((S.mask[li]&qm)!==qm) return; for(const nd of needles){ if(findIn(S.lower,nd,S.off[li],S.off[li]+S.len[li])<0) return;} cand.push(li); top.push(li,scoreLine(S,li,needles)); };
  if(prev){ for(let i=0;i<prev.length;i++){ if(ctrl&&(i&65535)===0&&Atomics.load(ctrl,0)!==myId) return null; consider(prev[i]); } }
  else { let pos=0,last=-1; const lb=S.lowerBuf; const ab=Buffer.from(anchor);
    let it=0; while(true){ const p=lb.indexOf(ab,pos); if(p<0)break; const li=lineOf(S.off,S.n,p); pos=S.off[li]+S.len[li]+1; if(p+ab.length>S.off[li]+S.len[li]){continue;} 
      if(ctrl&&(++it&1023)===0&&Atomics.load(ctrl,0)!==myId) return null; consider(li);} }
  return {cand:Int32Array.from(cand),top,count:cand.length};
}
// strategy B: naive per-line JS strings
function searchB(lowerLines,terms,K=200){ const out=[]; for(let i=0;i<lowerLines.length;i++){const l=lowerLines[i]; let ok=true; for(const t of terms) if(!l.includes(t)){ok=false;break;} if(ok) out.push(i);} return out.length; }
// strategy C: per-line scan over typed arrays without anchor (mask + verify)
function searchC(S,terms){ const needles=terms.map(t=>Uint8Array.from(Buffer.from(t))); const qm=qmaskOf(terms); let c=0;
  for(let li=0;li<S.n;li++){ if((S.mask[li]&qm)!==qm)continue; let ok=true; for(const nd of needles){ if(findIn(S.lower,nd,S.off[li],S.off[li]+S.len[li])<0){ok=false;break;} } if(ok)c++; } return c; }
// strategy D: mask prefilter over all lines + verify + score (same output as A)
function searchD(S,terms,prev,K=200,ctrl,myId){ const needles=terms.map(t=>Uint8Array.from(Buffer.from(t))); const qm=qmaskOf(terms); const cand=[]; const top=new TopK(K);
  const n=prev?prev.length:S.n;
  for(let i=0;i<n;i++){ const li=prev?prev[i]:i; if((S.mask[li]&qm)!==qm)continue; const s0=S.off[li],e0=s0+S.len[li]; let ok=true;
    for(const nd of needles){ if(findIn(S.lower,nd,s0,e0)<0){ok=false;break;} } if(!ok)continue; cand.push(li); top.push(li,scoreLine(S,li,needles));
    }
  return {cand:Int32Array.from(cand),top,count:cand.length}; }
module.exports={build,searchA,searchB,searchC,searchD};
