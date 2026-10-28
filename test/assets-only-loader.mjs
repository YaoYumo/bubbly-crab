// Node-only geometry regressions import road modules that also reference Vite
// image/model URLs. Stub those URLs only; JavaScript and runtime code stay real.
export async function load(url,context,nextLoad){
  if(/\.(?:png|jpe?g|webp|svg|gif|glb|gltf)(?:\?.*)?$/.test(url))return{format:'module',source:`export default ${JSON.stringify(url)};`,shortCircuit:true};
  return nextLoad(url,context);
}
