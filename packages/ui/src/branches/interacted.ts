let touched = false;

if (typeof window !== "undefined") {
  const note = () => {
    touched = true;
    window.removeEventListener("pointerdown", note, true);
    window.removeEventListener("keydown", note, true);
  };
  window.addEventListener("pointerdown", note, true);
  window.addEventListener("keydown", note, true);
}

/** Whether a key or pointer has been pressed on this page yet. */
export const hasInteracted = (): boolean => touched;
