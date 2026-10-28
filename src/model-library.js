import { buildPrimitiveModel } from './primitive-model.js';
import { ProjectAssets } from './project-assets.js';
import { uid } from './util.js';

const DB = 'previz-model-library';
const DEFAULT_GROUP = { id: 'my_models', cat: '我的模型' };
const MAX_TOTAL = 192 * 1024 * 1024;
const cleanName = value => String(value || '').trim().slice(0, 80);

function openDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('meta');
      r.result.createObjectStore('assets');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(Error('其他窗口正在占用模型库，请关闭后重试'));
  });
}
function request(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = tx.onerror = () => reject(tx.error || Error('模型库写入失败'));
  });
}

// Library membership is separate from scene resources and scene undo. Removing a
// library entry must never invalidate a placed instance, an archive or an undo.
export class ModelLibrary {
  constructor(app, builtins) {
    this.app = app;
    this.builtins = builtins;
    this.meta = { version: 1, groups: [{ ...DEFAULT_GROUP }], models: [], hidden: [] };
    this.busy = false;
    this.error = null;
    this.ready = this.load().catch(error => {
      this.error = error;
      this.app.bus.emit('library-changed');
      this.app.notify('模型库本地存储不可用：' + error.message, 'warn');
    });
  }
  async load() {
    const db = await openDB();
    try {
      const data = await request(db.transaction('meta').objectStore('meta').get('index'));
      if (data) {
        if (data.version !== 1 || !Array.isArray(data.models) || !Array.isArray(data.groups) || !Array.isArray(data.hidden)) throw Error('模型库索引损坏，未覆盖已有数据');
        this.meta = data;
      }
    } finally { db.close(); }
    this.app.bus.emit('library-changed');
  }
  groups() { return [...this.builtins.map(g => ({ id: g.id, cat: g.cat })), ...this.meta.groups]; }
  find(key) { return this.meta.models.find(m => m.key === key); }
  visible(key) { return !this.meta.hidden.includes(key); }
  assertEditable() {
    if (this.error) throw Error('本地模型库存储不可用，未修改任何条目');
    if (this.busy) throw Error('模型库正在处理文件，请稍候');
    const a = this.app;
    if (a.state.playing || a.stage.exporting || a.stage.exportOwner || a.exporter?.running || a.reference?.busy || a.aiScene?.busy || a.behaviors?.busy || a.sceneRecipeBusy) throw Error('请先停止播放、导出或场景任务');
  }
  async write(meta, additions = new Map(), deletions = []) {
    const db = await openDB();
    try {
      const tx = db.transaction(['meta', 'assets'], 'readwrite');
      const completion = done(tx), store = tx.objectStore('meta');
      const revision = this.meta.revision || 0;
      let conflict;
      const current = store.get('index');
      current.onsuccess = () => {
        if ((current.result?.revision || 0) !== revision) {
          conflict = Error('模型库已在其他窗口更新，已重新读取，请重试');tx.abort();return;
        }
        meta.revision = revision + 1;
        store.put(meta, 'index');
        for (const [id, text] of additions) tx.objectStore('assets').put(text, id);
        for (const id of deletions) tx.objectStore('assets').delete(id);
      };
      try { await completion; }
      catch (e) { if(conflict){await this.load();throw conflict;}throw e; }
      this.meta = meta;
      this.app.bus.emit('library-changed');
    } finally { db.close(); }
  }
  async change(fn) {
    await this.ready;
    this.assertEditable();
    this.busy = true;
    try { const next = structuredClone(this.meta); fn(next); await this.write(next); }
    finally { this.busy = false; this.app.bus.emit('library-changed'); }
  }
  async createGroup(name) {
    name = cleanName(name);
    if (!name) throw Error('请输入分组名称');
    const group = { id: uid('custom_'), cat: name };
    await this.change(meta => {
      if (this.groups().some(g => g.cat.toLowerCase() === name.toLowerCase())) throw Error('已经有同名分组');
      meta.groups.push(group);
    });
    return group.id;
  }
  async move(key, groupId) {
    await this.change(meta => {
      if (!this.groups().some(g => g.id === groupId)) throw Error('分组不存在');
      const model = meta.models.find(m => m.key === key);
      if (!model) throw Error('模型已从库中删除');
      model.groupId = groupId;
    });
  }
  async remove(key) {
    await this.ready;
    this.assertEditable();
    this.busy = true;
    try {
      const next = structuredClone(this.meta), old = next.models.find(m => m.key === key);
      const deletions = [];
      if (old) {
        next.models = next.models.filter(m => m.key !== key);
        if (!next.models.some(m => m.assetId === old.assetId)) deletions.push(old.assetId);
      } else if (!next.hidden.includes(key)) next.hidden.push(key);
      await this.write(next, new Map(), deletions);
    } finally { this.busy = false; this.app.bus.emit('library-changed'); }
  }
  async restoreBuiltins() { await this.change(meta => { meta.hidden = []; }); }
  async record(assetId) {
    await this.ready;
    if (this.error) throw this.error;
    const db = await openDB();
    try {
      const text = await request(db.transaction('assets').objectStore('assets').get(assetId));
      if (!text) throw Error('模型库资源缺失，请重新导入原文件');
      return text;
    } finally { db.close(); }
  }
  async import(files, groupId, status = () => {}) {
    await this.ready;
    this.assertEditable();
    if (!this.groups().some(g => g.id === groupId)) throw Error('请选择有效分组');
    const list = Array.from(files);
    if (!list.some(f => /\.(glb|gltf|fbx|obj)$/i.test(f.name))) throw Error('请选择 GLB / GLTF / FBX / OBJ 及所需贴图、BIN、MTL 文件');
    if (list.some(f => /\.(previz|zip|json)$/i.test(f.name))) throw Error('这里仅导入模型；工程文件请从「工具 / 工程」打开');
    if (list.reduce((n, f) => n + f.size, 0) > MAX_TOTAL) throw Error('本次导入文件超过 192MB，请分批导入');
    this.busy = true;
    this.app.bus.emit('library-changed');
    try {
      status('正在读取模型和贴图…');
      const resources = new ProjectAssets();
      const models = await this.app.importFiles(list, null, { libraryOnly: true, resources, scale: 0 });
      if (!models.length) throw Error(models.errors?.map(e => e.message).join('；') || '没有成功读取模型，请检查依赖文件');
      const next = structuredClone(this.meta), additions = new Map();
      for (const model of models) {
        const id = uid('model_');
        next.models.push({ key: 'userlib:' + id, groupId, name: cleanName(model.name) || '用户模型', assetId: model.assetId, format: model.file.split('.').pop().toUpperCase() });
        additions.set(model.assetId, resources.records.get(model.assetId));
      }
      status('正在保存到本地模型库…');
      await this.write(next, additions);
      return { count: models.length, errors: models.errors || [] };
    } finally { this.busy = false; this.app.bus.emit('library-changed'); }
  }
  async savePrimitive(so, groupId = 'my_models') {
    await this.ready;this.assertEditable();
    if(!so?.root.userData.primitiveModel || !this.app.objects.includes(so))throw Error('请选择当前场景的AI组合粗模');
    if(!this.groups().some(g=>g.id===groupId))throw Error('模型分组不存在');
    this.busy=true;const root=buildPrimitiveModel(so.params);
    root.scale.copy(so.root.scale);
    try {
      const resources=new ProjectAssets(),assetId=await resources.register(root),next=structuredClone(this.meta);
      const model={key:'userlib:'+uid('model_'),groupId,name:cleanName(so.name)||'AI粗模',assetId,format:'AI粗模'};
      next.models.push(model);await this.write(next,new Map([[assetId,resources.records.get(assetId)]]));return model.key;
    } finally { root.traverse(n=>{n.geometry?.dispose();n.material?.dispose();});this.busy=false;this.app.bus.emit('library-changed'); }
  }
  async place(key, point) {
    try {
      await this.ready;
      this.assertEditable();
      const model = this.find(key);
      if (!model) throw Error('模型已从库中删除');
      const text = await this.record(model.assetId);
      if (!this.find(key)) throw Error('模型已从库中删除');
      return await this.app.addStoredModel(model, text, point);
    } catch (e) { this.app.notify('放置失败：' + e.message, 'err'); return null; }
  }
}
