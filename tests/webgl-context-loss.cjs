// Losing the GPU context must stop the render loop and tell the owner, instead of freezing silently.
const assert=require('node:assert/strict'),{launch}=require('./browser.cjs');
const URL=process.env.OFFICE_URL||'http://127.0.0.1:4173/';
(async()=>{
  const browser=await launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:860}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{try{sessionStorage.setItem('kantor-ai.wizardSnoozed','1')}catch{}});
    await page.goto(URL);await page.waitForFunction(()=>window.officeScene,null,{timeout:90000});
    const available=await page.evaluate(()=>{
      const canvas=document.getElementById('c'),gl=canvas.getContext('webgl2')||canvas.getContext('webgl');
      const extension=gl&&gl.getExtension('WEBGL_lose_context');
      if(!extension)return false;
      extension.loseContext();window.__loseContext=extension;return true;
    });
    assert.equal(available,true,'the browser exposes WEBGL_lose_context');
    await page.waitForFunction(()=>/Konteks grafis terputus/.test(document.getElementById('sceneStatus').textContent),null,{timeout:5000});
    const status=await page.locator('#sceneStatus').innerText();
    assert.match(status,/Muat ulang/,'the message tells the owner how to recover');
    assert.deepEqual(errors,[]);
    console.log('PASS: WebGL context loss stops the renderer and shows a recovery message');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
