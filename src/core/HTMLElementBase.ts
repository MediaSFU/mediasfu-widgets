// Web-component modules are part of the package entry point, including for
// React/headless consumers. Keep module evaluation safe in Node and SSR while
// retaining the native HTMLElement prototype in browsers.
export const HTMLElementBase: typeof HTMLElement =
  typeof HTMLElement === 'undefined'
    ? (class {} as unknown as typeof HTMLElement)
    : HTMLElement;
