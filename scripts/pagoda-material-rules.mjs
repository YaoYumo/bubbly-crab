// Reviewed against source node names and world-space bounds, not height-only painting.
// Misnamed Base_Platform copies are ornate upper balcony rails (6.26–19.10 m).
const upperBalconies = new Set([19,99,187,275,363]);
export function pagodaRole(name,node) {
  if (upperBalconies.has(node)) return {role:'timber',reason:'reviewed upper balcony railing; misleading Base_Platform name',grain:'horizontal'};
  if (/^Base_/.test(name)) return {role:'stone',reason:'base courses, stairs or ground-level stone balustrade'};
  if (/^Roof_\d+_(Main|Ridge)$/.test(name)) return {role:'roof',reason:'roof surface or ridge'};
  if (/^Col_/.test(name)) return {role:'timber',reason:'structural column',grain:'vertical'};
  if (/^(Bracket\d_|Rail(Bottom|Top)_|Roof_\d+_EaveBoard|Floor_\d+_Slab)/.test(name)) return {role:'timber',reason:'bracket, rail, eave fascia or floor structure',grain:'horizontal'};
  if (/^Floor_\d+_Wall/.test(name)) return {role:'panel',reason:'timber wall panel',grain:'vertical'};
  if (/^(Door|Frame|Niche)_/.test(name)) return {role:'joinery',reason:'solid door, frame or niche; no inferred glazing',grain:'vertical'};
  if (/^(Buddha|Spire)_/.test(name)) return {role:'gilt',reason:'Buddha or spire ornament; authored copper-gold interpretation'};
  if (/^BellCord_/.test(name)) return {role:'cord',reason:'hanging cord, not metal bell'};
  if (/^Bell(Clapper)?_/.test(name)) return {role:'bronze',reason:'bell or clapper'};
  if (/^SpireCable_/.test(name)) return {role:'iron',reason:'spire tension cable'};
  throw Error(`Unreviewed Pagoda part: ${node} ${name}`);
}
