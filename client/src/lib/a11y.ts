import type { KeyboardEvent } from "react";

export function handleRovingTabKey<T extends string>(
  event: KeyboardEvent,
  values: readonly T[],
  current: T,
  setCurrent: (value: T) => void,
) {
  const index = values.indexOf(current);
  if (index < 0) return;

  if (event.key === "ArrowRight") {
    setCurrent(values[(index + 1) % values.length]);
    event.preventDefault();
  } else if (event.key === "ArrowLeft") {
    setCurrent(values[(index - 1 + values.length) % values.length]);
    event.preventDefault();
  } else if (event.key === "Home") {
    setCurrent(values[0]);
    event.preventDefault();
  } else if (event.key === "End") {
    setCurrent(values[values.length - 1]);
    event.preventDefault();
  }
}
