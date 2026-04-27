import { GameCanvas } from "~/components/game/GameCanvas";
import { PlayTopNav } from "~/components/game/PlayTopNav";

type PlayPageProps = {
  searchParams?: Promise<{
    bg?: string | string[];
  }>;
};

export default async function PlayPage({ searchParams }: PlayPageProps) {
  const resolvedSearchParams = await searchParams;
  const bgParam = resolvedSearchParams?.bg;
  const isBackgroundMode = Array.isArray(bgParam)
    ? bgParam.includes("1")
    : bgParam === "1";

  return (
    <div className={isBackgroundMode ? "play-bg-mode" : undefined}>
      {!isBackgroundMode && <PlayTopNav />}
      <GameCanvas backgroundMode={isBackgroundMode} />
    </div>
  );
}
