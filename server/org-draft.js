// Extract complete JSON objects, respecting braces and escapes inside strings. Never eval model output.
function withoutTrailingCommas(text){
  let out='',quoted=false,escaped=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){out+=c;if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
    if(c==='"')quoted=true;
    if(c===','){let j=i+1;while(/\s/.test(text[j]||'')&&j<text.length)j++;if(text[j]===']'||text[j]==='}')continue;}
    out+=c;
  }
  return out;
}
// First complete JSON object in a model answer that `accept` returns truthy for (prose, fences and <think> blocks are skipped).
function findJson(answer,accept){
  const text=String(answer).replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi,'');
  for(let start=0;start<text.length;start++){
    if(text[start]!=='{')continue;
    let depth=0,quoted=false,escaped=false;
    for(let i=start;i<text.length;i++){
      const c=text[i];
      if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
      if(c==='"'){quoted=true;continue;}
      if(c==='{')depth++;else if(c==='}')depth--;
      if(depth!==0)continue;
      try{const found=accept(JSON.parse(withoutTrailingCommas(text.slice(start,i+1))));if(found)return found;}catch{}
      break;
    }
  }
  return null;
}
function parseDraft(answer){
  const found=findJson(answer,obj=>{obj=obj.organization||obj.org||obj.draft||obj;return Array.isArray(obj.divisions)&&Array.isArray(obj.members)?obj:null;});
  if(!found)throw new Error('JSON organisasi tidak lengkap atau terpotong; diperlukan divisions dan members.');
  return found;
}
module.exports={parseDraft,findJson};
