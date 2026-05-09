// Ambient typing for bundler-resolved static asset imports (Vite, Webpack).
// MapView's leaflet default-icon helper imports leaflet/dist/images/*.png
// at module load to wire L.Icon.Default; without these declarations the
// package's own typecheck rejects the import paths.
//
// MUST stay an ambient script (no top-level imports/exports) so wildcard
// module declarations are read by tsc in script context.

declare module "*.png" {
  const url: string;
  export default url;
}
