#!/usr/bin/env python3
"""Block publication when rental source units, JSON, rendered prices or monthly stats disagree."""
import html,json,re,sys,statistics
from pathlib import Path
PERIODS = {
 'per month':('month','/mo'), 'per week':('week','/wk'), 'per day':('day','/day'),
 'per year':('year','/yr'), 'per sqft/per year':('sqft-year','/sq ft/yr'),
 'per sqft/per month':('sqft-month','/sq ft/mo'), 'per acre/per month':('acre-month','/acre/mo'),
 'per acre/per year':('acre-year','/acre/yr'), 'for the summer season':('summer','/summer season'),
 'for the winter season':('winter','/winter season')}
def expected(l):
 return PERIODS.get(str(l.get('leasePriceDesc') or '').strip().lower(),('unknown',' (period unconfirmed)'))
def closed(l):
 return any(x in str(l.get('status','')).lower() for x in ('closed','sold'))
def check_listing(l, index, detail, page):
 period,suffix=expected(l)
 assert 'leasePriceDesc' in l and l.get('rentPeriod')==period, 'source period missing/inconsistent'
 for label, obj in [('index',index),('detail',detail)]:
  for k in ('rentPeriod','leasePriceDesc','rentalDuration','price'):
   assert obj.get(k)==l.get(k),label+' '+k+' differs'
 amount=l.get('closePrice') if closed(l) and l.get('closePrice') else l.get('price')
 text=('$'+format(round(amount),',')+suffix) if amount else 'Price on request'
 match=re.search(r'<div class="idx-price">(.*?)</div>',page,re.S)
 assert match and html.unescape(match.group(1))==text, 'rendered headline differs: expected '+text
 nodes=[]
 for block in re.findall(r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>',page,re.S):
  data=json.loads(block);nodes.extend(data.get('@graph',[]) if isinstance(data,dict) else [])
 offers=[n for n in nodes if n.get('@type')=='Offer']
 assert offers, 'missing Offer schema'
 if amount:
  assert offers[0].get('priceSpecification',{}).get('unitText')==(l.get('leasePriceDesc') or 'Period unconfirmed'), 'schema rate missing'
 for comp in detail.get('comps') or []:
  assert period!='unknown' and comp.get('rentPeriod')==period, 'mixed-period comp'
 return True

def verify(root):
 data=json.loads((root/'data/listings.json').read_text())['listings']
 assert data,'empty feed'
 index={str(l['mls']):l for l in json.loads((root/'data/listings-index.json').read_text())['listings']}
 rentals=[l for l in data if l.get('listingType')=='rent'];assert rentals,'no rentals examined'
 for l in rentals:
  try:
   slug=l['slug'];detail=json.loads((root/'data/listings'/f'{slug}.json').read_text())
   check_listing(l,index[str(l['mls'])],detail,(root/'homes'/f'{slug}.html').read_text())
  except Exception as e:raise AssertionError('MLS '+str(l.get('mls'))+': '+str(e)) from e
 stats=json.loads((root/'data/stats.json').read_text())
 by_mls={str(l['mls']):l for l in data}
 for card in stats.get('newToday',[]):
  l=by_mls[str(card['mls'])]
  if l.get('listingType')=='rent':
   assert card.get('rentPeriod')==l.get('rentPeriod'), 'homepage card missing period'
   assert card.get('leasePriceDesc')==l.get('leasePriceDesc'), 'homepage card rate differs'
 monthly=[l for l in rentals if not closed(l) and l.get('rentPeriod')=='month' and l.get('price')]
 for key,rows in [('medianRent',monthly),('medianRentStamford',[l for l in monthly if l.get('address',{}).get('city')=='Stamford'])]:
  median=statistics.median([l['price'] for l in rows]) if rows else None
  if median is not None and len(rows)%2==0: median=round(median)
  assert stats[key]==median,key+' includes nonmonthly rates'
 for key,limit in [('u1800',1800),('u2200',2200),('u3000',3000)]:
  assert stats['rentBands'][key]==sum(l['price']<=limit for l in monthly),'mixed-period budget band '+key
 print('Rental pricing verified:',len(rentals),'records, rendered headlines, JSON, schema, comps and monthly statistics')
if __name__=='__main__':
 try:verify(Path(sys.argv[1] if len(sys.argv)>1 else '.'))
 except Exception as e:print('RENTAL PRICING FAILED:',str(e),file=sys.stderr);sys.exit(1)
