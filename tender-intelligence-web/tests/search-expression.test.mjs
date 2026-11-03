import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSearchExpression} from '../search-expression.mjs';

test('AND OR NOT parentheses retain precedence and positive relevance terms',()=>{
 const r=parseSearchExpression('(資安 OR 網路) AND NOT 租賃');
 assert.deepEqual(r.positives,['資安','網路']);
 assert.equal(r.tree.op,'and');
 assert.equal(r.tree.children[0].op,'or');
 assert.equal(r.tree.children[1].op,'not');
 assert.equal(r.tree.children[1].child.value,'租賃');
});

test('implicit AND and quoted phrases are parsed without collapsing the phrase',()=>{
 const r=parseSearchExpression('"網路 設備" OR (維護 保固)');
 assert.equal(r.tree.op,'or');
 assert.equal(r.tree.children[0].value,'網路 設備');
 assert.equal(r.tree.children[1].op,'and');
 assert.deepEqual(r.positives,['網路 設備','維護','保固']);
});

test('lowercase operators and unary minus are supported',()=>{
 const r=parseSearchExpression('醫療 or (教育 and -租賃)');
 assert.equal(r.tree.op,'or');
 assert.equal(r.tree.children[1].children[1].op,'not');
 assert.deepEqual(r.positives,['醫療','教育']);
});

test('plain query falls back to existing AND/OR/exclusion parser',()=>{
 assert.equal(parseSearchExpression('資訊 設備 -租賃'),null);
});

test('invalid parentheses and operators fail closed',()=>{
 for(const query of ['(資安 OR 網路','資安 AND','OR 網路','(資訊 AND)','資安 OR )']){
  assert.throws(()=>parseSearchExpression(query),query);
 }
});

test('bounded query limits cannot be bypassed via nested tokens',()=>{
 assert.throws(()=>parseSearchExpression('('+Array(13).fill('資安').join(' OR ')+')'));
 assert.throws(()=>parseSearchExpression('資安 OR '+'x'.repeat(61)));
});
