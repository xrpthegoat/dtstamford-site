"""Drive the publish scanner against captured real before/after HTML, without touching live data."""
import importlib.util
from pathlib import Path
ROOT=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('gate',ROOT/'verify-rental-pricing.py');g=importlib.util.module_from_spec(s);s.loader.exec_module(g)
l={'mls':'24210095','listingType':'rent','status':'Active','price':2000,'rentPeriod':'week',
   'leasePriceDesc':'Per Week','rentalDuration':'Flexible Terms Furnished,Month-to-Month Furnished,Short Term Furnished'}
good=(ROOT/'fixtures/weekly-after.txt').read_text()
bad=(ROOT/'fixtures/weekly-before.txt').read_text()
assert g.check_listing(l,l,l,good)
for name,args in [('original broken page',(l,l,l,bad)),('missing period',({k:v for k,v in l.items() if k!='rentPeriod'},l,l,good)),('mixed-period comparables',(l,l,{**l,'comps':[{'rentPeriod':'month'}]},good)),('missing HTML',(l,l,l,''))]:
 try:g.check_listing(*args)
 except (AssertionError,KeyError):print('Rejected:',name)
 else:raise AssertionError('Scanner accepted '+name)
print('Rental publication scanner positive/negative/unreadable tests passed')
