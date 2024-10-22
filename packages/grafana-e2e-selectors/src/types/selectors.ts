/**
 * A string selector
 */

export type StringSelector = string;

/**
 * A function selector with one argument
 */
export type FunctionSelector = (id: string) => string;

/**
 * A function selector with two arguments
 */
export type FunctionSelector2 = (arg1: string, arg2: string) => string;

/**
 * A function selector without argument
 */
export type CssSelector = () => string;

export interface Selectors {
  [key: string]: StringSelector | FunctionSelector | FunctionSelector2 | CssSelector | UrlSelector | Selectors;
}

export type E2ESelectors<S extends Selectors> = {
  [P in keyof S]: S[P];
};

export interface UrlSelector extends Selectors {
  url: string | FunctionSelector;
}

export type VersionedFunctionSelector1 = Record<string, FunctionSelector>;

export type VersionedFunctionSelector2 = Record<string, FunctionSelector2>;

export type VersionedStringSelector = Record<string, StringSelector>;

export type VersionedCssSelector = Record<string, CssSelector>;

export type VersionedUrlSelector = Record<string, UrlSelector>;

export type VersionedSelectors =
  | VersionedFunctionSelector1
  | VersionedFunctionSelector2
  | VersionedStringSelector
  | VersionedCssSelector
  | VersionedUrlSelector;

export type VersionedSelectorGroup = {
  [property: string]: VersionedSelectors | VersionedSelectorGroup;
};

export type SelectorsOf<T> = {
  [Property in keyof T]: T[Property] extends VersionedFunctionSelector1
    ? FunctionSelector
    : T[Property] extends VersionedFunctionSelector2
      ? FunctionSelector2
      : T[Property] extends VersionedStringSelector
        ? StringSelector
        : T[Property] extends VersionedCssSelector
          ? CssSelector
          : T[Property] extends VersionedUrlSelector
            ? UrlSelector
            : SelectorsOf<T[Property]>;
};
