"use client";

export function GridBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0" aria-hidden="true">
      {/* Ambient amber glow — arena lights */}
      <div
        className="absolute inset-0 transition-opacity duration-500"
        style={{
          background: [
            "radial-gradient(ellipse 40% 30% at 50% 0%, rgba(245,158,11,0.06) 0%, transparent 70%)",
            "radial-gradient(ellipse 25% 25% at 20% 60%, rgba(245,158,11,0.03) 0%, transparent 70%)",
            "radial-gradient(ellipse 25% 25% at 80% 60%, rgba(245,158,11,0.03) 0%, transparent 70%)",
          ].join(", "),
        }}
      />

      {/* Large grid — warm amber */}
      <div
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage: `
            linear-gradient(to right, rgba(245,158,11,0.07) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(245,158,11,0.07) 1px, transparent 1px)
          `,
          backgroundSize: "80px 80px",
          mask: "radial-gradient(ellipse 60% 50% at 50% 30%, black, transparent)",
          WebkitMask:
            "radial-gradient(ellipse 60% 50% at 50% 30%, black, transparent)",
        }}
      />

      {/* Small grid — subtle warm */}
      <div
        className="absolute inset-0 opacity-40"
        style={{
          backgroundImage: `
            linear-gradient(to right, rgba(250,250,249,0.03) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(250,250,249,0.03) 1px, transparent 1px)
          `,
          backgroundSize: "16px 16px",
          mask: "radial-gradient(ellipse 50% 40% at 50% 30%, black, transparent)",
          WebkitMask:
            "radial-gradient(ellipse 50% 40% at 50% 30%, black, transparent)",
        }}
      />

      {/* Subtle noise/grain texture overlay */}
      <div
        className="absolute inset-0 opacity-[0.015]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          backgroundSize: "256px 256px",
        }}
      />
    </div>
  );
}
