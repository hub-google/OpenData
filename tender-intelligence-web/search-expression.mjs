// F02: safe, bounded Boolean search grammar. No eval, regex execution or dynamic SQL.
// Explicit operators: AND, OR, NOT, parentheses. AND binds tighter than OR.
// Adjacent terms imply AND. Quoted phrases are one term. -term is unary NOT.
export function parseSearchExpression(input){
 const raw=String(input??'');
 if(raw.length>450)throw Error('查詢最多 450 字');
 if(!/[()]|\b(?:AND|OR|NOT)\b/i.test(raw))return null;
 const rx=/-?"[^"]*"|[()]|[^\s()]+/g,tokens=[];
 let position=0,match;
 while((match=rx.exec(raw))!==null){
  if(raw.slice(position,match.index).trim())throw Error('查詢包含無法辨識的符號');
  tokens.push(match[0]);position=rx.lastIndex;
 }
 if(raw.slice(position).trim())throw Error('查詢有未閉合的引號或不支援的符號');
 if(tokens.length>42)throw Error('查詢運算式過長');
 let i=0,termCount=0;
 const head=()=>tokens[i];
 const isOp=(x,v)=>typeof x==='string'&&x.toUpperCase()===v;
 const term=x=>{
  let v=x.startsWith('+')?x.slice(1):x;
  if(v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1);
  if(v.includes('"')||!v.trim()||v.length>60)throw Error('關鍵字不可空白、含不完整引號或超過 60 字');
  termCount++;if(termCount>12)throw Error('布林運算式最多 12 個關鍵字');
  return {op:'term',value:v.trim()};
 };
 function primary(depth){
  if(depth>6)throw Error('括號巢狀過深（最多 6 層）');
  const x=head();
  if(x==='('){
   i++;const value=parseOr(depth+1);
   if(head()!==')')throw Error('左右括號未成對');
   i++;return value;
  }
  if(!x||x===')'||isOp(x,'AND')||isOp(x,'OR'))throw Error('AND／OR 左右都必須有關鍵字');
  i++;return term(x);
 }
 function unary(depth){
  const x=head();
  if(isOp(x,'NOT')){i++;return {op:'not',child:unary(depth+1)};}
  if(x?.startsWith('-')&&x.length>1){i++;return {op:'not',child:term(x.slice(1))};}
  return primary(depth);
 }
 const combine=(op,a,b)=>a.op===op?{op,children:[...a.children,b]}:{op,children:[a,b]};
 function parseAnd(depth){
  let left=unary(depth);
  while(i<tokens.length&&head()!==')'&&!isOp(head(),'OR')){
   if(isOp(head(),'AND'))i++;
   if(i>=tokens.length||head()===')'||isOp(head(),'OR'))throw Error('AND 後面缺少條件');
   left=combine('and',left,unary(depth));
  }
  return left;
 }
 function parseOr(depth){
  let left=parseAnd(depth);
  while(isOp(head(),'OR')){
   i++;if(i>=tokens.length)throw Error('OR 後面缺少條件');
   left=combine('or',left,parseAnd(depth));
  }
  return left;
 }
 if(!tokens.length)throw Error('查詢條件不可空白');
 const tree=parseOr(0);
 if(i!==tokens.length)throw Error('布林運算式包含多餘的括號或運算符');
 const positives=[];
 const walk=(node,negated=false)=>{
  if(node.op==='term'){if(!negated)positives.push(node.value);return;}
  if(node.op==='not'){walk(node.child,!negated);return;}
  for(const child of node.children)walk(child,negated);
 };
 walk(tree);
 if(JSON.stringify(tree).length>3000)throw Error('查詢運算式過長');
 return {tree,positives:[...new Set(positives)]};
}
