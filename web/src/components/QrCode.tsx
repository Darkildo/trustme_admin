import QRCode from "qrcode";
import { useMemo } from "react";
import { cn } from "@/lib/utils";

/** QR code rendered locally to inline SVG (no network, no data: URIs — CSP friendly). */
export function QrCode({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const { path, size } = useMemo(() => {
    const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
    const n = qr.modules.size;
    let d = "";
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.modules.get(r, c)) d += `M${c + 2} ${r + 2}h1v1h-1z`;
      }
    }
    return { path: d, size: n + 4 };
  }, [value]);
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className={cn("rounded-md", className)}
    >
      <rect width={size} height={size} className="fill-qr-bg" />
      <path d={path} className="fill-qr-fg" />
    </svg>
  );
}
