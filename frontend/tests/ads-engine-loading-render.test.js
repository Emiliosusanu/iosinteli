import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source=readFileSync(new URL('../src/components/OverviewChartWidgets.tsx',import.meta.url),'utf8');
const home=readFileSync(new URL('../app/(tabs)/index.tsx',import.meta.url),'utf8');
const element=(type,props,...children)=>({type,props:props??{},children});
const exports={};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS}}).outputText,{exports,require(name){
  if(name==='react')return{default:{createElement:element},useMemo:fn=>fn(),useState:v=>[v,()=>{}],useCallback:fn=>fn};
  if(name==='react-native')return{TouchableOpacity:'Button',Text:'Text',View:'View'};
  if(name==='@tanstack/react-query')return{useQuery:()=>({isPending:true,isError:false,data:undefined})};
  if(name.endsWith('/periodQuery'))return{sortedProfileIds:ids=>[...ids].sort()};
  if(name.endsWith('/adsEngineSeries'))return{dailyToAdsEngineSeries:()=>({impressions:[]})};
  if(name.endsWith('/theme'))return{useTheme:()=>({}),dashboard:{}};
  return{SwipeEmpty:'Empty',AdsEngineChart:'Chart'};
}});
const series={impressions:[],clicks:[],orders:[],acos:[],totals:{}};

test('actual Ads Engine Campaigns render never calls pending, FX-pending or failed data empty',()=>{
  for(const options of [{loading:true},{loading:true,loadingMessage:'Updating currency conversion...'},{loading:true,error:true},{error:true}]){
    const tree=exports.AdsEngineCampaignsPage({series,width:320,breakEvenAcos:0,...options});
    const empty=tree.type==='Button'?tree.children[0]:tree;
    assert.doesNotMatch(empty.props.message,/No ads metrics/);
    assert.match(empty.props.message,options.error?/unavailable/:options.loadingMessage?/currency conversion/:/Loading/);
  }
  const empty=exports.AdsEngineCampaignsPage({series,width:320,breakEvenAcos:0});
  assert.equal(empty.props.message,'No ads metrics in this period.');
});
test('actual keyword and search-term pages expose FX failure instead of an indefinitely disabled loading query',()=>{
  for(const Component of [exports.AdsEngineKeywordsPage,exports.AdsEngineSearchTermsPage]) {
    let retries=0;
    const base={profileIds:['us'],moneyProfileIds:['us'],profileCurrencyById:new Map([['us','USD']]),displayCurrency:'USD',fxReady:false,start:'2026-10-01',end:'2026-10-18',width:320,breakEvenAcos:0,onRetryFx:()=>retries++};
    const failed=Component({...base,fxFailed:true});
    assert.equal(failed.children[0].props.kind,'error');
    assert.match(failed.children[0].props.message,/conversion unavailable/);
    failed.props.onPress();assert.equal(retries,1);
    const pending=Component({...base,fxFailed:false});
    assert.equal(pending.children[0].props.kind,'loading');
    assert.equal(pending.props.disabled,true);
  }
});
test('actual failed Campaigns view exposes a working retry and Home wires the real query state',()=>{
  let retries=0;
  const tree=exports.AdsEngineCampaignsPage({series,width:320,breakEvenAcos:0,error:true,onRetry:()=>retries++});
  tree.props.onPress();assert.equal(retries,1);
  assert.match(home,/<AdsEngineCampaignsPage\s+loading=\{!adsReady\}/);
  assert.match(home,/needsAdsFx && fxRatesQ\.isError/);
  assert.match(home,/onRetry=\{\(\) => void onRefresh\(\)\}/);
});
