import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const deepSpace = "#090b10";
const pixelFont = '"Press Start 2P", monospace';

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

export const PassChickLogoReveal = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const intro = spring({
    frame,
    fps,
    config: {
      damping: 15,
      mass: 0.8,
      stiffness: 120,
    },
  });

  const logoScale = interpolate(intro, [0, 1], [0.72, 1]);
  const logoY = interpolate(frame, [0, 32, 70, 90], [38, 0, 0, -10], clamp);
  const logoOpacity = interpolate(frame, [0, 10], [0, 1], clamp);
  const titleOpacity = interpolate(frame, [24, 40], [0, 1], clamp);
  const titleY = interpolate(frame, [24, 50], [30, 0], {
    ...clamp,
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const subtitleOpacity = interpolate(frame, [46, 62], [0, 1], clamp);
  const subtitleY = interpolate(frame, [46, 68], [18, 0], {
    ...clamp,
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const shimmerX = interpolate(frame, [42, 68], [-25, 120], clamp);

  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        background:
          `radial-gradient(circle at 50% 32%, #1a2435 0%, #111724 40%, ${deepSpace} 78%)`,
        color: "#fff",
        fontFamily:
          "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <style>{`@import url("https://fonts.googleapis.com/css?family=Press+Start+2P");`}</style>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(115deg, rgba(142,238,223,0.055), transparent 38%, rgba(246,201,91,0.07) 76%, transparent)",
        }}
      />

      <div
        style={{
          alignItems: "center",
          display: "flex",
          flexDirection: "column",
          width: "100%",
          transform: `translateY(${logoY}px)`,
        }}
      >
        <Img
          src={staticFile("favicon.png")}
          style={{
            opacity: logoOpacity,
            width: 320,
            height: 320,
            objectFit: "contain",
            transform: `scale(${logoScale})`,
            filter: "drop-shadow(0 30px 36px rgba(0,0,0,0.5))",
          }}
        />

        <div
          style={{
            marginTop: 34,
            opacity: titleOpacity,
            position: "relative",
            transform: `translateY(${titleY}px)`,
          }}
        >
          <div
            style={{
              alignItems: "baseline",
              display: "inline-flex",
              fontFamily: pixelFont,
              fontSize: 72,
              fontWeight: 400,
              gap: 0,
              letterSpacing: 0,
              lineHeight: 1,
              textRendering: "geometricPrecision",
              whiteSpace: "nowrap",
            }}
          >
            <span
              style={{
                color: "#ffffff",
                textShadow:
                  "0 1px 0 rgba(255,255,255,0.45), 0 8px 18px rgba(4,10,20,0.35)",
              }}
            >
              EGG
            </span>
            <span
              style={{
                background:
                  "linear-gradient(180deg, #fff1b3 0%, #f6c24a 45%, #c48a1f 100%)",
                backgroundClip: "text",
                color: "#f7c44a",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                textShadow:
                  "0 1px 0 rgba(255,241,179,0.4), 0 8px 18px rgba(6,12,24,0.35)",
              }}
            >
              SISTENTIAL
            </span>
          </div>
          <div
            style={{
              background: `linear-gradient(90deg, transparent ${shimmerX - 12}%, rgba(255,255,255,0.62) ${shimmerX}%, transparent ${shimmerX + 12}%)`,
              inset: 0,
              mixBlendMode: "screen",
              position: "absolute",
            }}
          />
        </div>

        <div
          style={{
            color: "#0797ad",
            fontFamily: pixelFont,
            fontSize: 18,
            fontWeight: 400,
            letterSpacing: 0,
            marginTop: 30,
            opacity: subtitleOpacity,
            textShadow: "0 0 10px rgba(7,151,173,0.24)",
            transform: `translateY(${subtitleY}px)`,
          }}
        >
          PROOF-OF-SURVIVAL ARCADE ON CELO
        </div>
      </div>

      <div
        style={{
          bottom: 0,
          height: 178,
          left: 0,
          position: "absolute",
          right: 0,
          background: `linear-gradient(0deg, rgba(9,11,16,1), rgba(9,11,16,0))`,
        }}
      />

    </AbsoluteFill>
  );
};
