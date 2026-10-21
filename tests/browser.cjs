// Shared browser launcher for the UI tests.
//
// chrome-headless-shell has no GPU of its own, so WebGL falls back to the
// SwiftShader software rasterizer and the 3D office scene is rasterized on the
// CPU. That pins every core and costs ~450 MB per browser. Point ANGLE at the
// real GPU instead. When no usable GPU is present Chrome quietly falls back to
// SwiftShader on its own, so this can only help.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
// Each platform has its own ANGLE backend.
const ANGLE={win32:'d3d11',darwin:'metal',linux:'gl'}[process.platform]||'default';
const GPU_ARGS=['--use-angle='+ANGLE,'--ignore-gpu-blocklist','--enable-gpu-rasterization'];
const launch=async options=>{
  try{return await chromium.launch({...options,args:[...(options&&options.args||[]),...GPU_ARGS]});}
  catch{return chromium.launch(options);}// a rejected GPU flag must never fail a test
};
module.exports={launch,GPU_ARGS};
