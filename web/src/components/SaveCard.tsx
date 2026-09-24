import { useState } from "react";

/** Saves a card as a PNG at twice its size, drawn from its SVG. */
export function SaveCard({ load, file, label = "Save the card" }: { load: () => Promise<string>; file: string; label?: string }) {
  const [state, setState] = useState<string | null>(null);
  const save = async () => {
    setState("Drawing…");
    try {
      const svg = await load();
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
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
      URL.revokeObjectURL(url);
      const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!png) throw new Error("The card could not be saved.");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(png);
      a.download = file;
      a.click();
      setState(null);
    } catch (e) {
      setState((e as Error).message);
    }
  };
  return (
    <>
      <button type="button" onClick={() => void save()}>
        {label}
      </button>
      {state && <span className="note small">{state}</span>}
    </>
  );
}
