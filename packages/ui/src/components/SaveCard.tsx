import { Button } from "@astryxdesign/core/Button";
import { useToast } from "@astryxdesign/core/Toast";

/** Draws a card's SVG as a PNG at twice its size. */
async function png(svg: string): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("The card could not be drawn."));
      img.src = url;
    });
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth * scale;
    canvas.height = img.naturalHeight * scale;
    const cx = canvas.getContext("2d");
    if (!cx) throw new Error("This browser cannot draw the card.");
    cx.scale(scale, scale);
    cx.drawImage(img, 0, 0);
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!out) throw new Error("The card could not be saved.");
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Saves a card as a PNG at twice its size, drawn from its SVG. */
export function SaveCard({ load, file, label = "Save the card" }: { load: () => Promise<string>; file: string; label?: string }) {
  const toast = useToast();
  const save = async () => {
    try {
      const blob = await png(await load());
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = file;
      a.click();
    } catch (e) {
      toast({ body: (e as Error).message, type: "error" });
    }
  };
  return <Button label={label} variant="secondary" size="sm" clickAction={save} />;
}
