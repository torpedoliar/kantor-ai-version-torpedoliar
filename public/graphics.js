// Graphics level (Low/Medium/High/Ultra): the table, the device default, and the viewer's saved choice.
(() => {
  const KEY='kantor-ai.graphics.v1';
  const LEVELS={
    low:{label:'Low',pixelRatio:.75,shadow:0,textures:null,env:false,ao:false,bloom:false},
    medium:{label:'Medium',pixelRatio:1,shadow:1024,textures:'1k',env:false,ao:false,bloom:false},
    high:{label:'High',pixelRatio:1.25,shadow:2048,textures:'1k',env:true,ao:false,bloom:false},
    ultra:{label:'Ultra',pixelRatio:2,shadow:4096,textures:'2k',env:true,ao:true,bloom:true},
  };
  const read=()=>{try{return localStorage.getItem(KEY);}catch{return null;}};
  const write=value=>{try{localStorage.setItem(KEY,value);}catch{}};
  // Automated browsers and missing WebGL2 get Low; a real GPU with enough cores gets High; anything else Medium.
  function detect(){
    if(navigator.webdriver)return 'low';
    const gl=document.createElement('canvas').getContext('webgl2');if(!gl)return 'low';
    const info=gl.getExtension('WEBGL_debug_renderer_info'),name=String(info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER));
    return !/SwiftShader|llvmpipe|Basic Render/i.test(name)&&(navigator.hardwareConcurrency||0)>=4?'high':'medium';
  }
  const query=new URLSearchParams(location.search).get('graphics');
  let level=LEVELS[query]?query:LEVELS[read()]?read():detect();
  const listeners=[];
  window.officeGraphics={
    LEVELS,
    level:()=>level,
    set(next){if(!LEVELS[next])return level;level=next;write(next);listeners.forEach(fn=>fn(next));return level;},
    onChange(fn){listeners.push(fn);},
  };
})();
