/**
 * What a model is made of: every material with its triangle and primitive
 * count, alpha mode, base colour, metalness, roughness and extensions, then
 * the mesh and node totals. For seeing why a model draws slowly (a
 * thousand primitives), why it looks wrong (a black sunshield with
 * metalness 0), or what an `original.materials` fix should match.
 * Usage: npx tsx scripts/dev/meshlist.mts <file.gltf|glb>
 * Reads draco-compressed files; pair with scripts/dev/bounds.ts for size and axes.
 */
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import draco3d from "draco3dgltf";
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "draco3d.decoder": await draco3d.createDecoderModule() });
const doc = await io.read(process.argv[2]!);
const root = doc.getRoot();
const byMat = new Map<string, { tris: number; prims: number; alpha: string; base: number[]; metal: number; rough: number; ext: string[] }>();
for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
  const m = p.getMaterial(); const name = m?.getName() ?? "(none)";
  const idx = p.getIndices(); const n = idx ? idx.getCount() / 3 : (p.getAttribute("POSITION")?.getCount() ?? 0) / 3;
  const e = byMat.get(name) ?? { tris: 0, prims: 0, alpha: m?.getAlphaMode() ?? "", base: m?.getBaseColorFactor() ?? [], metal: m?.getMetallicFactor() ?? 0, rough: m?.getRoughnessFactor() ?? 0, ext: m?.listExtensions().map((x) => x.extensionName) ?? [] };
  e.tris += n; e.prims += 1; byMat.set(name, e);
}
for (const [k, v] of [...byMat].sort((a, b) => b[1].tris - a[1].tris)) console.log(k.padEnd(28), String(Math.round(v.tris)).padStart(7), "prims", String(v.prims).padStart(3), v.alpha, v.base.map((x) => x.toFixed(2)).join(","), "m", v.metal.toFixed(2), "r", v.rough.toFixed(2), v.ext.join(","));
console.log("meshes", root.listMeshes().length, "nodes", root.listNodes().length);
