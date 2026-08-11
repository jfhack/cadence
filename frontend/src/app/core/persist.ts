import { effect, untracked } from '@angular/core';

export function persistOnChange<T>(source: () => T, write: (value: T) => void): void {
  const restored = JSON.stringify(untracked(source));
  let dirty = false;
  effect(() => {
    const value = source();
    if (!dirty) {
      if (JSON.stringify(value) === restored) {
        return;
      }
      dirty = true;
    }
    write(value);
  });
}
