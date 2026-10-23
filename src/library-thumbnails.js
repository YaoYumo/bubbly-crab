import * as THREE from 'three';
import { buildAsset, defaultsFor } from './assets.js';
import { ProjectAssets } from './project-assets.js';

// One isolated, lazily-created renderer. Never borrow the viewport, change global
// detail settings, render a scene instance, or dispose its shared resources.
export class LibraryThumbnails {
  constructor(app) {
    this.app = app;
    this.cache = new Map();
    this.queue = new Map();
    this.nodes = new WeakMap();
    this.observer = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (e.isIntersecting) { const job=this.nodes.get(e.target);if(job)this.queue.set(e.target,job); }
        else this.queue.delete(e.target);
      }
      this.schedule();
    }, { rootMargin: '80px' });
  }
  watch(node, item) {
    const data=this.cache.get(item.assetId||item.key);
    if(data){const img=document.createElement('img');img.src=data;img.alt=item.name;img.draggable=false;node.replaceChildren(img);node.dataset.thumbnail='ready';return;}
    this.nodes.set(node, item);
    this.observer.observe(node);
  }
  reset() { this.observer.disconnect();this.queue.clear(); }
  schedule(delay=40) {
    if (this.scheduled || this.running || !this.queue.size) return;
    this.scheduled = true;
    setTimeout(() => this.next(), delay);
  }
  async next() {
    this.scheduled = false;
    const a=this.app;
    if(a.state.playing||a.stage.dragging||a.stage.exporting||a.stage.exportOwner||a.exporter?.running||a.aiScene?.busy||a.reference?.busy||a.modelLibrary.busy){this.schedule(240);return;}
    const entry=this.queue.entries().next().value;
    if(!entry)return;
    const [node,item]=entry;this.queue.delete(node);this.observer.unobserve(node);
    this.running=true;
    if(node.isConnected && node.getClientRects().length){
      const key=item.assetId||item.key;
      try {
        let data=this.cache.get(key);
        if(!data){data=await this.render(item);this.cache.set(key,data);if(this.cache.size>128)this.cache.delete(this.cache.keys().next().value);}
        if(node.isConnected){
          const img=document.createElement('img');img.src=data;img.alt=item.name;img.draggable=false;img.decoding='async';
          node.replaceChildren(img);node.dataset.thumbnail='ready';
        }
      }catch(e){if(node.isConnected){node.dataset.thumbnail='fallback';node.title='模型预览不可用，仍可放置：'+e.message;}}
    }
    this.running=false;this.schedule();
  }
  init() {
    if(this.unavailable)throw Error('此环境没有可用的缩略图 WebGL 上下文');
    if(this.renderer)return;
    try{this.renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});}
    catch(e){this.unavailable=true;throw e;}
    this.renderer.setSize(256,192,false);this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=.95;
    this.scene=new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xffffff,0x9292b6,1.2));
    const key=new THREE.DirectionalLight(0xfff5e5,2.7);key.position.set(3,5,4);this.scene.add(key);
    const fill=new THREE.DirectionalLight(0xc2cbff,.7);fill.position.set(-3,2,-4);this.scene.add(fill);
    this.camera=new THREE.OrthographicCamera(-1.5,1.5,1.125,-1.125,.01,100);
  }
  async render(item) {
    this.init();
    let root,resources;
    if(item.assetId){
      resources=new ProjectAssets();resources.hydrate({[item.assetId]:await this.app.modelLibrary.record(item.assetId)});
      root=resources.instantiate(item.assetId);await resources.ready();
    }else root=buildAsset(item.source,defaultsFor(item.source));
    const wrapper=new THREE.Group(),geometries=new Map();
    const palette=[0xb5afcf,0x77728e,0x59657d].map(color=>new THREE.MeshStandardMaterial({color,roughness:.85,metalness:0,side:THREE.DoubleSide}));
    const material=m=>{
      if(m?.transparent||m?.transmission>0||m?.userData?.role==='glass')return palette[2];
      const c=m?.color,luma=c?c.r*.2126+c.g*.7152+c.b*.0722:1;
      return palette[luma<.12||m?.userData?.detail==='tile'?1:0];
    };
    let meshes=0;
    try{
      root.traverse(o=>{
        if(o.isMesh){
          meshes++;
          // Clone geometry even if a builder keeps a module-level shared mesh.
          if(!geometries.has(o.geometry))geometries.set(o.geometry,o.geometry.clone());
          o.geometry=geometries.get(o.geometry);o.material=Array.isArray(o.material)?o.material.map(material):material(o.material);o.castShadow=false;
        }else if(o.isSprite||o.isLine||o.isPoints||o.isLight)o.visible=false;
      });
      if(!meshes)throw Error('无可渲染网格');
      root.updateMatrixWorld(true);
      const box=new THREE.Box3().setFromObject(root),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
      const extent=Math.max(size.x,size.y,size.z);
      if(!Number.isFinite(extent)||extent<=0)throw Error('模型边界无效');
      const factor=1.65/extent;
      root.position.sub(center);wrapper.add(root);wrapper.scale.setScalar(factor);this.scene.add(wrapper);
      this.camera.position.set(3,2.2,3);this.camera.lookAt(0,0,0);this.camera.updateProjectionMatrix();
      this.renderer.setClearColor(0x000000,0);this.renderer.render(this.scene,this.camera);
      return this.renderer.domElement.toDataURL('image/png');
    } finally {
      wrapper.removeFromParent();
      root?.traverse(o=>{if(o.isInstancedMesh)o.dispose();});
      for(const g of geometries.values())g.dispose();
      palette.forEach(m=>m.dispose());this.renderer.renderLists.dispose();
    }
  }
}
