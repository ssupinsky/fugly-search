// synthetic code-like corpus (deterministic)
module.exports=function gen(n){
  let seed=12345; const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const common=['const','return','if','else','function','import','from','export','this','value','data','error','string','number','user','index','result','async','await','props','state'];
  const mid=[];const syl=['aut','tok','ref','res','con','fig','man','ag','er','ser','ver','cli','ent','que','ry','han','dl','er','pro','vid','cac','he','val','id','at','or','par','se','bui','ld'];
  for(let i=0;i<4000;i++){let w='';const k=1+Math.floor(rnd()*3);for(let j=0;j<k;j++)w+=syl[Math.floor(rnd()*syl.length)];mid.push(w);}
  const rare=[];for(let i=0;i<200000;i++)rare.push('x'+Math.floor(rnd()*1e9).toString(36));
  const lines=[];
  for(let i=0;i<n;i++){
    const nt=1+Math.floor(rnd()*rnd()*14); let parts=[];
    for(let j=0;j<nt;j++){const r=rnd(); parts.push(r<0.35?common[Math.floor(rnd()*common.length)]:r<0.9?mid[Math.floor(rnd()*mid.length)]:rare[Math.floor(rnd()*rare.length)]);}
    const style=rnd(); let s;
    if(style<0.3) s=parts.map((p,k)=>k?p[0].toUpperCase()+p.slice(1):p).join('');
    else if(style<0.5) s=parts.join('_');
    else if(style<0.8) s=parts.join(' ')+(rnd()<0.5?';':' {');
    else s=parts[0]+'('+parts.slice(1).join(', ')+')';
    if(rnd()<0.03) s+=' // '+parts.join(' ').repeat(1+Math.floor(rnd()*6));
    lines.push(' '.repeat(Math.floor(rnd()*5)*2)+s);
  }
  // plant known phrases
  for(let i=0;i<n;i+=997) lines[i]='  const authToken = await refreshToken(session);';
  for(let i=5;i<n;i+=20011) lines[i]='  // auth token refresh failed: '+i;
  return lines;
};
