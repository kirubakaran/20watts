/**
 * Prints the bounds, root node transforms and texture sizes of a glTF or
 * glb, for deciding a new model's unitScale and rotation before it goes in
 * the collection. Usage: npx tsx scripts/dev/bounds.ts <file.gltf|glb>
 */
import { NodeIO, getBounds } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

async function main() {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(process.argv[2]!);
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]!;
  const b = getBounds(scene);
  console.log("min", b.min.map((n) => n.toFixed(3)).join(" "), " max", b.max.map((n) => n.toFixed(3)).join(" "));
  console.log("size", b.max.map((n, i) => (n - b.min[i]!).toFixed(3)).join(" × "));
  for (const n of doc.getRoot().listNodes().slice(0, 5)) console.log("node", JSON.stringify(n.getName()), "scale", n.getScale(), "rotation", n.getRotation());
  console.log("meshes", doc.getRoot().listMeshes().length, "textures", doc.getRoot().listTextures().map((t) => t.getSize()?.join("x")).join(", "));
}
main().catch((e) => { console.error(e); process.exit(1); });
