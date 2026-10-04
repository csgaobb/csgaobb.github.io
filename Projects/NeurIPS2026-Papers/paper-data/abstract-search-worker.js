"use strict";
const TOTAL_SHARDS=79;
const abstracts=new Map();
let loaded=false;
globalThis.__paperAbstractShard=(_shard,data)=>{
  for(const [id,text] of Object.entries(data)) abstracts.set(Number(id),text);
};
const normalize=value=>String(value||"").normalize("NFKD").toLocaleLowerCase();
const terms=query=>normalize(query).match(/"[^"]+"|\S+/g)?.map(x=>x.replace(/^"|"$/g,""))||[];
function loadAll(){
  if(loaded) return;
  for(let shard=0;shard<TOTAL_SHARDS;shard++){
    importScripts(`abstracts-${String(shard).padStart(3,"0")}.js`);
    postMessage({type:"progress",loaded:shard+1,total:TOTAL_SHARDS});
  }
  loaded=true;
}
onmessage=event=>{
  if(event.data.type!=="search") return;
  const requestId=event.data.requestId;
  try{
    loadAll();
    const queryTerms=terms(event.data.query);
    const ids=[];
    for(const [id,abstract] of abstracts){
      const haystack=normalize(abstract);
      if(queryTerms.every(term=>haystack.includes(term))) ids.push(id);
    }
    postMessage({type:"results",requestId,ids});
  }catch(error){
    postMessage({type:"error",requestId,message:String(error)});
  }
};
