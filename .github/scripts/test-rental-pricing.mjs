import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../../assets/homes/rental-pricing.js',import.meta.url),'utf8');
const {rentSuffix,withinBudget,comparePrice}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const rent=(rentPeriod,price=2000)=>({listingType:'rent',rentPeriod,price});
assert.equal(rentSuffix(rent('week')),'/wk');
assert.equal(rentSuffix(rent('month')),'/mo');
assert.equal(rentSuffix(rent('summer')),'/summer season');
assert.equal(rentSuffix(rent('sqft-year')),'/sq ft/yr');
assert.equal(rentSuffix(rent('acre-month')),'/acre/mo');
assert.equal(rentSuffix(rent(undefined)),' (period unconfirmed)');
assert.equal(rentSuffix(rent('new-unknown-value')),' (period unconfirmed)');
assert.equal(rentSuffix({listingType:'sale',price:200000}),'');
for(const period of ['week','day','year','summer','winter','sqft-year','acre-month','unknown',undefined]) {
 assert.equal(withinBudget(rent(period),0,2500),false);
 assert.equal(withinBudget(rent(period),1000,0),false);
 assert.equal(withinBudget(rent(period),0,0),true);
}
assert.equal(withinBudget(rent('month'),0,2500),true);
assert.equal(withinBudget(rent('month',2600),0,2500),false);
assert.equal(withinBudget({listingType:'sale',price:500000},0,600000),true);
assert.deepEqual([rent('week',2000),rent('month',3000),rent('month',2500)].sort(comparePrice).map(l=>[l.rentPeriod,l.price]),[['month',2500],['month',3000],['week',2000]]);
console.log('Rental UI regression tests passed: weekly/monthly/seasonal/area/unknown, budgets and sorting');
