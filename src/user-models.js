// Additive user-supplied library assets. Original models stay in their own groups.
import preview from './user-models/pagoda/preview.png';
import woodPreview from './user-models/pagoda/wood-preview.png';
import { buildPagodaWood, PAGODA_WOOD_KEY, PAGODA_WOOD_PALETTE } from './user-models/pagoda/wood.js';
export { buildPagodaWood, PAGODA_WOOD_KEY };
import { buildPagoda, PAGODA_INFO } from './user-models/pagoda/build.js';
export { buildPagoda };
export { PAGODA_INFO };
export const PAGODA_KEY = 'user_models:pagoda_uploaded:Pagoda 宝塔（用户模型）';
export const USER_MODEL_GROUPS = [{
  id:'user_models',cat:'用户模型',items:[{
    type:'pagoda_uploaded',name:'Pagoda 宝塔（用户模型）',icon:'pagoda',thumbnail:preview,build:buildPagoda,
    description:'用户提供的静态宝塔；原文件没有材质/贴图，以可调色灰模显示。高度单位暂按米。',
    params:[
      {k:'height',l:'宝塔高 m',t:'range',min:1,max:120,step:.1,def:PAGODA_INFO.sourceBounds.size[1]},
      {k:'color',l:'灰模颜色',t:'color',def:'#c4c6c8'},
    ],
  }],
}];

// Related library variant, appended beside the original CN pagoda, not a replacement.
export const PAGODA_WOOD_ITEM={
  type:'pagoda_wood_uploaded',name:'楼阁式佛塔·木构变体',icon:'pagoda',thumbnail:woodPreview,build:buildPagodaWood,
  variantOf:'cn:pagoda:楼阁式佛塔',
  description:'上传宝塔的固定六层木构变体：石台基、木柱梁栏与壁板、灰瓦、铜铃及铜金塔刹。材质为新增设计，非恢复原贴图；高度暂按米。',
  params:[
    {k:'height',l:'宝塔高 m',t:'range',min:1,max:120,step:.1,def:PAGODA_INFO.sourceBounds.size[1]},
    ...Object.values(PAGODA_WOOD_PALETTE).filter(p=>p.param).map(p=>({k:p.param,l:({woodColor:'柱梁栏木色',panelColor:'木壁板色',doorColor:'门框佛龛色',roofColor:'瓦面屋脊色',stoneColor:'台基石色',bronzeColor:'铜铃色',giltColor:'塔刹佛像色'})[p.param],t:'color',def:p.color})),
  ],
};
