import "@testing-library/jest-dom/vitest";
import "@/i18n";

// jsdom не знает ResizeObserver и pointer capture, а Radix (Checkbox, Select) на них опирается.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (typeof Element !== "undefined") {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
}
