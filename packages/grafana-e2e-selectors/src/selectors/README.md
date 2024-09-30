# Versioned selectors

The selectors defined in [pages.ts](./pages.ts) and [components.ts](./components.ts) are versioned. A versioned selector consists of an object literal where value is the selector context and key is the minimum Grafana version for which the value is valid. Every selector needs to be backwards compatible, so for every version of the selector the signature needs to be the same.

The versioning is important in plugin end-to-end testing, as it allows them to resolve the right selector values for a given Grafana version. Across

## How to change the value of an existing selector

1. Add a new key to the versioned selector object.
