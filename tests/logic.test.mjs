import test from 'node:test';import assert from 'node:assert/strict';import {instructions,roles,number,day,transition,totals} from '../lib/logic.mjs';import handler from '../netlify/functions/os.mjs';
test('nine scoped agents and review restrictions',()=>{assert.equal(Object.keys(roles).length,9);for(const r of Object.keys(roles))assert.match(instructions(r),/EUR30\/h/);assert.throws(()=>instructions('admin'))});
test('approval only from review',()=>{assert.equal(transition('review','approve'),'approved');assert.equal(transition('pending','approve'),null);assert.equal(transition('review','reject'),'rejected')});
test('unknown vs zero, validates dates and numeric values',()=>{assert.equal(number('',true,true),null);assert.equal(number('0',true,true),0);assert.throws(()=>number(-1));assert.throws(()=>number(0.5,true,true));assert.equal(day('2026-11-25'),'2026-11-25');assert.throws(()=>day('2026-02-30'))});
test('cash and time remain distinct',()=>assert.deepEqual(totals([{revenue_eur:'690',cost_eur:'20',hours:'5'}]),{revenue:690,cost:20,hours:5}));
test('unconfigured API fails closed',async()=>{const r=await handler(new Request('http://local/'));assert.equal(r.status,503)});
test('reject inherited object names as roles',()=>assert.throws(()=>instructions('toString')));
