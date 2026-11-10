import test from 'node:test';
import assert from 'node:assert/strict';
import {readBasicSearchUrl,writeBasicSearchUrl} from '../search-url.mjs';
test('full search state is round-trippable and preserves unrelated UTM params',()=>{
 const state={mode:'vendor',query:'臺灣科技',page:4,status:'決標',group:'財物',min:'500000',sort:'budget',scenario:'all'};
 const url=writeBasicSearchUrl('https://hub-google.github.io/OpenData/tender-intelligence-web/?utm_source=direct',state);
 assert.ok(url.includes('utm_source=direct'));
 assert.deepEqual(readBasicSearchUrl(url.split('?')[1]),state);
});
test('rejects invalid URL modes, unrelated views and unsafe filter values',()=>{
 assert.equal(writeBasicSearchUrl('https://example.com/?view=advanced',{mode:'latest'}),null);
 assert.equal(writeBasicSearchUrl('https://example.com/?case_unit=A&case_no=B',{mode:'latest'}),null);
 const state=readBasicSearchUrl('?mode=bad&page=-2&status=unsafe&group=garbage&min=-1&sort=random&scenario=unknown');
 assert.equal(state.mode,'latest');assert.equal(state.page,1);
 assert.equal(state.status,'全部');assert.equal(state.group,'全部');
 assert.equal(state.min,'');assert.equal(state.sort,'date');assert.equal(state.scenario,'all');
});
test('empty defaults do not clutter a shared URL',()=>{
 assert.equal(writeBasicSearchUrl('https://example.com/path',{mode:'latest',query:'',page:1,scenario:'all',status:'全部',group:'全部',min:'',sort:'date'}),'/path');
});
