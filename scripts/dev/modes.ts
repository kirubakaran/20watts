import { NodeIO, Primitive } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
async function main() {
  const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
  const doc = await io.read(process.argv[2]!);
  const modes = new Map<number, number>();
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) modes.set(p.getMode(), (modes.get(p.getMode()) ?? 0) + 1);
  console.log("modes:", [...modes.entries()], "POINTS =", Primitive.Mode.POINTS);
}
main();
