const assert=require('node:assert/strict');
const {launch}=require('./browser.cjs');
(async()=>{
  const browser=await launch({headless:true});
  try{
    const page=await browser.newPage();
    await page.setContent('<main><h1>Playwright ready</h1></main>');
    assert.equal(await page.locator('h1').innerText(),'Playwright ready');
    console.log(`PASS: Playwright ${require('playwright/package.json').version} launched Chromium and inspected a page`);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
