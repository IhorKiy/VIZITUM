// Tenant logo when one is uploaded, the "V" glyph otherwise. Always a plain
// <img>: presigned URLs rotate per render (next/image would refuse them
// without remotePatterns anyway) and SVG logos stay inert inside <img> —
// never inline uploaded SVG markup.
export function BrandMark({ logoUrl }: { logoUrl: string | null }) {
  if (!logoUrl) {
    return <div className="brand-mark">V</div>;
  }

  // eslint-disable-next-line @next/next/no-img-element -- see file comment above
  return <img alt="" className="brand-logo" src={logoUrl} />;
}
