const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVM_ADDRESS_RE = /^0x[0-9a-f]{40}$/i;

const DIVISIONS = ["ROOKIE", "RUNNER", "STEADY", "ELITE", "ORACLE"] as const;
const SEASON_STATUSES = ["ACTIVE", "FREEZING", "SETTLING", "SETTLED"] as const;
const SEASON_ZONES = ["PROMOTION", "RELEGATION", "SAFE", "PASSIVE"] as const;
const SEASON_MOVEMENTS = ["PROMOTED", "RELEGATED", "STAYED"] as const;

export type GameDivision = (typeof DIVISIONS)[number];
export type SeasonStatus = (typeof SEASON_STATUSES)[number];
export type SeasonZone = (typeof SEASON_ZONES)[number];
export type SeasonMovement = (typeof SEASON_MOVEMENTS)[number];

export type GameStartedV2 = {
  sessionId: string;
  clientSessionId: string;
  ticketCost: 1;
  ticketBalanceAfter: bigint;
  seasonId: string | null;
  division: GameDivision;
  startedAt: string;
  replayed: boolean;
};

export type GameEndedV2 = {
  sessionId: string;
  status: "CRASHED" | "COMPLETED";
  finalCheckpoint: number;
  pointsAwarded: number;
  seasonPointsTotal: number;
  seasonId: string | null;
  division: GameDivision;
  ticketBalance: bigint;
  endedAt: string;
};

export type GameStartErrorAction =
  | "NONE"
  | "REAUTH"
  | "TOP_UP"
  | "RECOVER"
  | "RETRY";

export type GameStartErrorState = {
  code: string;
  message: string;
  retryable: boolean;
  ticketBalance: bigint | null;
  action: GameStartErrorAction;
};

export type SeasonStanding = {
  rank: number;
  walletAddress: string;
  points: number;
  lastPointAt: string | null;
  zone: SeasonZone;
  movement: SeasonMovement | null;
};

export type SeasonViewer = {
  walletAddress: string;
  division: GameDivision;
  rank: number | null;
  points: number;
  zone: SeasonZone;
};

export type SeasonLeaderboard = {
  season: {
    seasonNumber: number;
    startsAt: string;
    endsAt: string;
    status: SeasonStatus;
  };
  division: GameDivision;
  standings: SeasonStanding[];
  zones: {
    promotionCount: number;
    relegationCount: number;
    activePlayers: number;
    smallDivision: boolean;
  };
  viewer: SeasonViewer | null;
  total: number;
  limit: number;
  offset: number;
};

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} is missing or invalid.`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string) {
  const parsed = typeof value === "string" ? value.trim() : "";
  if (!parsed) throw new TypeError(`${label} is missing or invalid.`);
  return parsed;
}

function requireInteger(
  value: unknown,
  label: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
) {
  const parsed = typeof value === "string" && value.trim() ? Number(value) : value;
  if (
    typeof parsed !== "number" ||
    !Number.isSafeInteger(parsed) ||
    parsed < minimum ||
    parsed > maximum
  ) {
    throw new TypeError(`${label} is missing or invalid.`);
  }
  return parsed;
}

function requireBoolean(value: unknown, label: string) {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} is missing or invalid.`);
  }
  return value;
}

function requireIsoDate(value: unknown, label: string) {
  const parsed = requireString(value, label);
  if (!Number.isFinite(Date.parse(parsed))) {
    throw new TypeError(`${label} is missing or invalid.`);
  }
  return parsed;
}

function requireUuidV4(value: unknown, label: string) {
  const parsed = requireString(value, label);
  if (!UUID_V4_RE.test(parsed)) {
    throw new TypeError(`${label} must be a UUID v4.`);
  }
  return parsed;
}

function requireAddress(value: unknown, label: string) {
  const parsed = requireString(value, label).toLowerCase();
  if (!EVM_ADDRESS_RE.test(parsed)) {
    throw new TypeError(`${label} is missing or invalid.`);
  }
  return parsed;
}

function requireBigInt(value: unknown, label: string) {
  try {
    const parsed = BigInt(value as string | number | bigint);
    if (parsed < 0n) throw new Error();
    return parsed;
  } catch {
    throw new TypeError(`${label} is missing or invalid.`);
  }
}

function requireEnum<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string,
): T[number] {
  const parsed = requireString(value, label).toUpperCase();
  if (!allowed.includes(parsed as T[number])) {
    throw new TypeError(`${label} is missing or invalid.`);
  }
  return parsed as T[number];
}

function readSeasonId(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" && typeof value !== "number") {
    throw new TypeError("Season id is invalid.");
  }
  return String(value);
}

function readNullableIsoDate(value: unknown, label: string) {
  if (value === null || value === undefined || value === "") return null;
  return requireIsoDate(value, label);
}

function readNullableMovement(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  return requireEnum(value, SEASON_MOVEMENTS, "Season movement");
}

export function isGameV2TicketModeEnabled(value: string | undefined) {
  return String(value || "").trim().toLowerCase() === "true";
}

export function buildSocketSessionAuth(token: string | null | undefined) {
  const normalized = String(token || "").trim();
  if (!normalized) {
    throw new Error("Backend session token is required before connecting the game socket.");
  }
  return { token: normalized };
}

export function createGameClientSessionId(
  current: string | null | undefined,
  uuidFactory: () => string = () => globalThis.crypto.randomUUID(),
) {
  const normalized = String(current || "").trim();
  if (UUID_V4_RE.test(normalized)) return normalized;
  const generated = String(uuidFactory() || "").trim();
  if (!UUID_V4_RE.test(generated)) {
    throw new Error("Game client session id factory must return a UUID v4.");
  }
  return generated;
}

export function parseGameStartedV2(payload: unknown): GameStartedV2 {
  const root = requireRecord(payload, "V2 game start response");
  if (root.success !== true) {
    throw new TypeError("V2 game start response is missing or invalid.");
  }
  const session = requireRecord(root.session, "V2 game session");
  const ticketCost = requireInteger(session.ticketCost, "Ticket cost", 1, 1);

  return {
    sessionId: requireUuidV4(session.sessionId, "Server session id"),
    clientSessionId: requireUuidV4(session.clientSessionId, "Client session id"),
    ticketCost: ticketCost as 1,
    ticketBalanceAfter: requireBigInt(
      session.ticketBalanceAfter,
      "Ticket balance after start",
    ),
    seasonId: readSeasonId(session.seasonId),
    division: requireEnum(session.division, DIVISIONS, "Game division"),
    startedAt: requireIsoDate(session.startedAt, "Game start time"),
    replayed: requireBoolean(root.replayed, "Game replay state"),
  };
}

export function classifyGameStartError(payload: unknown): GameStartErrorState {
  const root = requireRecord(payload, "V2 game start error");
  const code = requireString(root.code || "INTERNAL", "Game start error code")
    .toUpperCase();
  const retryable = root.retryable === true;
  const data =
    root.data && typeof root.data === "object" && !Array.isArray(root.data)
      ? (root.data as Record<string, unknown>)
      : {};
  const ticketBalance =
    data.ticketBalance === undefined
      ? null
      : requireBigInt(data.ticketBalance, "Ticket balance");

  let action: GameStartErrorAction = "NONE";
  if (code === "UNAUTHENTICATED") action = "REAUTH";
  else if (code === "INSUFFICIENT_TICKETS") action = "TOP_UP";
  else if (code === "SESSION_ALREADY_ACTIVE") action = "RECOVER";
  else if (retryable) action = "RETRY";

  return {
    code,
    message:
      typeof root.message === "string" && root.message.trim()
        ? root.message.trim()
        : "Unable to start the game.",
    retryable,
    ticketBalance,
    action,
  };
}

export function parseGameEndedV2(payload: unknown): GameEndedV2 {
  const root = requireRecord(payload, "V2 game result response");
  if (root.success !== true) {
    throw new TypeError("V2 game result response is missing or invalid.");
  }
  const result = requireRecord(root.result, "V2 game result");
  const status = requireEnum(
    result.status,
    ["CRASHED", "COMPLETED"] as const,
    "Game result status",
  );

  return {
    sessionId: requireUuidV4(result.sessionId, "Server session id"),
    status,
    finalCheckpoint: requireInteger(
      result.finalCheckpoint,
      "Final checkpoint",
    ),
    pointsAwarded: requireInteger(result.pointsAwarded, "Points awarded"),
    seasonPointsTotal: requireInteger(
      result.seasonPointsTotal,
      "Season points total",
    ),
    seasonId: readSeasonId(result.seasonId),
    division: requireEnum(result.division, DIVISIONS, "Game division"),
    ticketBalance: requireBigInt(result.ticketBalance, "Ticket balance"),
    endedAt: requireIsoDate(result.endedAt, "Game end time"),
  };
}

function parseSeasonStanding(value: unknown): SeasonStanding {
  const row = requireRecord(value, "Season leaderboard row");
  return {
    rank: requireInteger(row.rank, "Season leaderboard rank", 1),
    walletAddress: requireAddress(
      row.walletAddress,
      "Season leaderboard wallet",
    ),
    points: requireInteger(row.points, "Season leaderboard points"),
    lastPointAt: readNullableIsoDate(row.lastPointAt, "Last point time"),
    zone: requireEnum(row.zone, SEASON_ZONES, "Season leaderboard zone"),
    movement: readNullableMovement(row.movement),
  };
}

function parseSeasonViewer(value: unknown): SeasonViewer | null {
  if (value === null || value === undefined) return null;
  const viewer = requireRecord(value, "Season leaderboard viewer");
  return {
    walletAddress: requireAddress(viewer.walletAddress, "Viewer wallet"),
    division: requireEnum(viewer.division, DIVISIONS, "Viewer division"),
    rank:
      viewer.rank === null || viewer.rank === undefined
        ? null
        : requireInteger(viewer.rank, "Viewer rank", 1),
    points: requireInteger(viewer.points, "Viewer points"),
    zone: requireEnum(viewer.zone, SEASON_ZONES, "Viewer zone"),
  };
}

export function parseSeasonLeaderboard(payload: unknown): SeasonLeaderboard {
  try {
    const root = requireRecord(payload, "Season leaderboard response");
    if (root.success !== true) {
      throw new TypeError("Season leaderboard response is missing or invalid.");
    }
    const season = requireRecord(root.season, "Season metadata");
    const zones = requireRecord(root.zones, "Season leaderboard zones");
    if (!Array.isArray(root.standings)) {
      throw new TypeError("Season leaderboard standings are missing or invalid.");
    }

    return {
      season: {
        seasonNumber: requireInteger(
          season.seasonNumber,
          "Season number",
          1,
        ),
        startsAt: requireIsoDate(season.startsAt, "Season start time"),
        endsAt: requireIsoDate(season.endsAt, "Season end time"),
        status: requireEnum(
          season.status,
          SEASON_STATUSES,
          "Season status",
        ),
      },
      division: requireEnum(root.division, DIVISIONS, "Leaderboard division"),
      standings: root.standings.map(parseSeasonStanding),
      zones: {
        promotionCount: requireInteger(
          zones.promotionCount,
          "Promotion count",
        ),
        relegationCount: requireInteger(
          zones.relegationCount,
          "Relegation count",
        ),
        activePlayers: requireInteger(zones.activePlayers, "Active players"),
        smallDivision: requireBoolean(
          zones.smallDivision,
          "Small division state",
        ),
      },
      viewer: parseSeasonViewer(root.viewer),
      total: requireInteger(root.total, "Season leaderboard total"),
      limit: requireInteger(root.limit, "Season leaderboard limit", 1, 100),
      offset: requireInteger(root.offset, "Season leaderboard offset"),
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new TypeError(`Season leaderboard is invalid: ${detail}`);
  }
}
