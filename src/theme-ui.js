import { el } from './util.js';

const KEY='previz.theme.v1';
const DEFAULT={background:'#f4efe7',panel:'#ffffff',accent:'#4a4fb0'};
const valid=c=>typeof c==='string'&&/^#[\da-f]{6}$/i.test(c);
const clean=p=>Object.fromEntries(Object.entries(DEFAULT).map(([k,v])=>[k,valid(p?.[k])?p[k]:v]));
const rgb=c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16));
const mix=(a,b,t)=>'#'+rgb(a).map((v,i)=>Math.round(v*(1-t)+rgb(b)[i]*t).toString(16).padStart(2,'0')).join('');
const ink=c=>{const l=rgb(c).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return .2126*l[0]+.7152*l[1]+.0722*l[2]>.179?'#1a1a2e':'#f4f3fa';};

export function installThemeControls(app,top){
  let saved;try{saved=JSON.parse(localStorage.getItem(KEY));}catch{}
  let palette=clean(saved?.palette),skin=['light','dark','custom'].includes(saved?.skin)?saved.skin:'light';
  const wrap=el('div',{class:'skin-wrap','aria-label':'界面主题'}),dots=[];
  const variables=['bg','bg2','bg3','card','card2','line','line2','fg','fg2','fg3','acc','acc2','acc-light'];
  function apply(id,p=palette){
    const root=document.documentElement;variables.forEach(k=>root.style.removeProperty('--'+k));
    root.dataset.skin=id;app.state.skin=id;
    if(id==='custom'){
      const bg=p.background,card=p.panel,fg=ink(card),baseInk=ink(bg);
      const vars={bg,bg2:mix(bg,baseInk,.035),bg3:mix(bg,baseInk,.07),card,card2:mix(card,fg,.025),line:mix(card,fg,.16),line2:mix(card,fg,.25),fg,fg2:mix(fg,card,.22),fg3:mix(fg,card,.36),acc:p.accent,acc2:mix(p.accent,ink(p.accent),.15),'acc-light':mix(card,p.accent,.14)};
      for(const [k,v]of Object.entries(vars))root.style.setProperty('--'+k,v);
    }
    dots.forEach(({id:which,node})=>{node.classList.toggle('on',which===id);node.setAttribute('aria-pressed',String(which===id));});
  }
  function persist(){try{localStorage.setItem(KEY,JSON.stringify({skin,palette}));}catch{app.notify('主题已应用，但当前存储不可用，无法记住设置','warn');}}
  function edit(){
    if(document.querySelector('.theme-mask'))return;
    const previous=document.activeElement;let draft={...palette};
    const body=el('div',{class:'theme-colors'}),foot=el('footer'),panel=el('section',{class:'theme-dialog',role:'dialog','aria-modal':'true','aria-label':'自定义主题'});
    const mask=el('div',{class:'theme-mask'},[panel]);
    const close=()=>{apply(skin);mask.remove();previous?.isConnected&&previous.focus();};
    const cancel=el('button',{class:'fbtn',type:'button',text:'取消',onclick:close});
    const inputs=[];
    for(const [key,label]of [['background','背景色'],['panel','面板色'],['accent','强调色']]){
      const hex=el('span',{text:draft[key]}),input=el('input',{type:'color',value:draft[key],'aria-label':label,dataset:{themeColor:key},oninput:e=>{draft[key]=e.target.value;hex.textContent=draft[key];apply('custom',draft);}});
      inputs.push(input);body.append(el('label',{},[el('span',{text:label}),input,hex]));
    }
    foot.append(el('button',{class:'fbtn',type:'button',text:'恢复默认配色',onclick:()=>{draft={...DEFAULT};inputs.forEach(n=>{n.value=draft[n.dataset.themeColor];n.dispatchEvent(new Event('input'));});}}),cancel,el('button',{class:'fbtn pri',type:'button',text:'保存并使用',dataset:{themeSave:'1'},onclick:()=>{palette=clean(draft);skin='custom';persist();close();}}));
    panel.append(el('header',{},[el('b',{text:'自定义主题'})]),el('p',{text:'调整界面配色并实时预览，不改变场景材质或光影。取消将恢复原主题。'}),body,foot);
    mask.addEventListener('pointerdown',e=>{if(e.target===mask)close();});
    mask.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();close();}if(e.key==='Tab'){const ns=[...panel.querySelectorAll('button,input')],i=ns.indexOf(document.activeElement);if(e.shiftKey&&i<=0){e.preventDefault();ns.at(-1).focus();}else if(!e.shiftKey&&i===ns.length-1){e.preventDefault();ns[0].focus();}}});
    document.body.append(mask);inputs[0].focus();
  }
  for(const [id,label,color]of [['light','浅色模式','#F4EFE7'],['dark','深色模式','#282940'],['custom','自定义主题','linear-gradient(135deg,#ff6b6b,#4ecdc4,#45b7d1)']]){
    const node=el('button',{class:'skin-dot',type:'button',title:label,'aria-label':label,style:`background:${color}`,onclick:()=>{if(id==='custom')edit();else{skin=id;apply(id);persist();}}});
    dots.push({id,node});wrap.append(node);
  }
  top.append(wrap);apply(skin);
  return {apply:()=>apply(skin)};
}
