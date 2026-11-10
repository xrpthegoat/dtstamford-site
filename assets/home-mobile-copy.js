
(()=>{
 let i=0;
 function collapse(parent,selector,label){
  const els=[...parent.querySelectorAll(selector)];if(!els.length)return;
  const button=document.createElement('button');button.className='mobile-copy-toggle';button.type='button';button.textContent=label+' +';button.setAttribute('aria-expanded','false');
  const ids=els.map(el=>{if(!el.id)el.id='mobile-copy-'+(++i);el.classList.add('mobile-extra');return el.id});button.setAttribute('aria-controls',ids.join(' '));els[0].before(button);
  button.addEventListener('click',()=>{const open=button.getAttribute('aria-expanded')!=='true';button.setAttribute('aria-expanded',String(open));button.textContent=open?'Show less −':label+' +';els.forEach(el=>el.classList.toggle('is-expanded',open));});
 }
 document.querySelectorAll('.tool-card').forEach(p=>collapse(p,':scope > p','How it works'));
 document.querySelectorAll('.svc .core').forEach(p=>collapse(p,':scope > p','More details'));
 const about=document.querySelector('.meet .row > div');if(about)collapse(about,':scope > p, :scope > .sign','Get to know John');
 document.querySelectorAll('.faq-cat').forEach(p=>collapse(p,':scope > .faq-list','View answers'));
 const hoods=document.querySelector('.hoods .row > div');if(hoods)collapse(hoods,':scope > p','Compare neighborhoods');
 const h=document.querySelector('.meet h2');if(h){h.classList.add('mobile-long-title');const s=document.createElement('h2');s.className='mobile-short-title';s.textContent='Meet John Restrepo.';h.after(s)}
 for(const [selector,title] of [['.faq .sec-head h2','Your questions, answered.'],['.hoods h2','Find your neighborhood.']]){const old=document.querySelector(selector);if(old){old.classList.add('mobile-long-title');const fresh=document.createElement('h2');fresh.className='mobile-short-title';fresh.textContent=title;old.after(fresh)}}
 const services=document.querySelector('.services .sec-head h2');if(services){services.classList.add('mobile-long-title');const s=document.createElement('h2');s.className='mobile-short-title';s.textContent='Buy. Sell. Rent.';services.after(s)}
})();
