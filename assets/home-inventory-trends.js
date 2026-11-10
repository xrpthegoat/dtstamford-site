(async()=>{
 const panels=[...document.querySelectorAll('.market-panel')];
 const nodes=panels.map(p=>{const e=document.createElement('div');e.className='market-trend';e.textContent='Loading monthly comparison…';p.querySelector('.market-panel-top').after(e);return e});
 const note=document.createElement('p');note.className='trend-note';document.querySelector('.market-grid').after(note);
 try {
  const [sr,hr]=await Promise.all([fetch('/data/stats.json'),fetch('/data/stats-history.csv')]);
  if(!sr.ok||!hr.ok)throw Error('data unavailable');
  const s=await sr.json();const csv=(await hr.text()).trim().split(/\r?\n/);const keys=csv.shift().split(',');
  const rows=csv.map(l=>Object.fromEntries(l.split(',').map((v,i)=>[keys[i],v])));
  const [year,month,day]=s.date.split('-').map(Number);const prior=new Date(Date.UTC(year,month-2,1));
  prior.setUTCDate(Math.min(day,new Date(Date.UTC(year,month-1,0)).getUTCDate()));
  const target=prior.toISOString().slice(0,10);
  const eastern=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(d));
  const before=rows.filter(r=>eastern(r.timestamp)===target).sort((a,b)=>a.timestamp.localeCompare(b.timestamp)).at(-1);
  if(!before)throw Error('no matching history');
  [['forSale','for_sale'],['forRent','for_rent']].forEach(([now,old],i)=>{
   const current=Number(s[now]),previous=Number(before[old]);if(!Number.isFinite(current)||!Number.isFinite(previous)||previous<=0)throw Error('invalid history');
   const pct=(current-previous)/previous*100;const v=document.createElement('span');v.className='trend-value '+(pct<0?'down':pct===0?'flat':'up');
   v.textContent=(pct>0?'↑ +':pct<0?'↓ −':'→ ')+Math.abs(pct).toFixed(1)+'%';
   const t=document.createElement('span');t.textContent=(pct>0?'more':pct<0?'fewer':'same number of')+' listings vs last month';
   nodes[i].replaceChildren(v,t);nodes[i].title=current.toLocaleString()+' now; '+previous.toLocaleString()+' on '+target;
  });
  const fmt=d=>new Date(d+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric'});
  note.textContent='Available listings in Stamford & nearby · '+fmt(s.date)+' vs '+fmt(target)+', '+year+'. Saved inventory snapshots.';
 }catch(e){nodes.forEach(n=>n.textContent='Monthly comparison unavailable');note.textContent='A matching prior-month inventory snapshot is needed to calculate the change.'}
})();
