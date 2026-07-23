import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSocketSessionAuth,
  classifyGameStartError,
  createGameClientSessionId,
  isGameV2TicketModeEnabled,
  parseGameEndedV2,
  parseGameStartedV2,
  parseSeasonLeaderboard,
} from "../v2Domain.ts";

const CLIENT_SESSION_ID = "3f6f9a4e-8f4b-4b1e-9d51-2a4bb0d7c9aa";
const SERVER_SESSION_ID = "bb501a12-46ef-4d79-9911-44716056841f";
const WALLET = "0x1111111111111111111111111111111111111111";

describe("FE-07 ticket gameplay domain", () => {
  it("enables ticket mode only for an explicit true flag", () => {
    assert.equal(isGameV2TicketModeEnabled("true"), true);
    assert.equal(isGameV2TicketModeEnabled("TRUE"), true);
    assert.equal(isGameV2TicketModeEnabled("false"), false);
    assert.equal(isGameV2TicketModeEnabled(undefined), false);
  });

  it("builds a token-only socket handshake and rejects an empty session", () => {
    assert.deepEqual(buildSocketSessionAuth(" bearer-token "), {
      token: "bearer-token",
    });
    assert.throws(
      () => buildSocketSessionAuth(""),
      /backend session token/i,
    );
  });

  it("reuses a valid client intent across retries and replaces invalid state", () => {
    assert.equal(
      createGameClientSessionId(CLIENT_SESSION_ID, () => SERVER_SESSION_ID),
      CLIENT_SESSION_ID,
    );
    assert.equal(
      createGameClientSessionId("not-a-uuid", () => SERVER_SESSION_ID),
      SERVER_SESSION_ID,
    );
    assert.throws(
      () => createGameClientSessionId(null, () => "invalid"),
      /UUID v4/i,
    );
  });

  it("parses a one-ticket start response without V1 stake fields", () => {
    assert.deepEqual(
      parseGameStartedV2({
        success: true,
        session: {
          sessionId: SERVER_SESSION_ID,
          clientSessionId: CLIENT_SESSION_ID,
          ticketCost: 1,
          ticketBalanceAfter: "6",
          seasonId: 1,
          division: "ROOKIE",
          startedAt: "2026-07-23T09:12:00.000Z",
        },
        replayed: false,
      }),
      {
        sessionId: SERVER_SESSION_ID,
        clientSessionId: CLIENT_SESSION_ID,
        ticketCost: 1,
        ticketBalanceAfter: 6n,
        seasonId: "1",
        division: "ROOKIE",
        startedAt: "2026-07-23T09:12:00.000Z",
        replayed: false,
      },
    );
  });

  it("normalizes V2 start failures into actionable frontend state", () => {
    assert.deepEqual(
      classifyGameStartError({
        success: false,
        code: "INSUFFICIENT_TICKETS",
        message: "No tickets",
        retryable: false,
        data: { ticketBalance: "0" },
      }),
      {
        code: "INSUFFICIENT_TICKETS",
        message: "No tickets",
        retryable: false,
        ticketBalance: 0n,
        action: "TOP_UP",
      },
    );
    assert.equal(
      classifyGameStartError({
        code: "TICKET_STATE_SYNCING",
        retryable: true,
      }).action,
      "RETRY",
    );
    assert.equal(
      classifyGameStartError({ code: "UNAUTHENTICATED" }).action,
      "REAUTH",
    );
    assert.equal(
      classifyGameStartError({ code: "SESSION_ALREADY_ACTIVE" }).action,
      "RECOVER",
    );
    assert.deepEqual(classifyGameStartError({}), {
      code: "INTERNAL",
      message: "Unable to start the game.",
      retryable: false,
      ticketBalance: null,
      action: "NONE",
    });
    assert.throws(
      () =>
        classifyGameStartError({
          code: "INSUFFICIENT_TICKETS",
          data: { ticketBalance: "-1" },
        }),
      /ticket balance/i,
    );
  });

  it("parses server-authoritative points and ticket balance after a run", () => {
    assert.deepEqual(
      parseGameEndedV2({
        success: true,
        result: {
          sessionId: SERVER_SESSION_ID,
          status: "COMPLETED",
          finalCheckpoint: 4,
          pointsAwarded: 3,
          seasonPointsTotal: 27,
          seasonId: "2026-08",
          division: "ROOKIE",
          ticketBalance: "6",
          endedAt: "2026-07-23T09:14:31.000Z",
        },
      }),
      {
        sessionId: SERVER_SESSION_ID,
        status: "COMPLETED",
        finalCheckpoint: 4,
        pointsAwarded: 3,
        seasonPointsTotal: 27,
        seasonId: "2026-08",
        division: "ROOKIE",
        ticketBalance: 6n,
        endedAt: "2026-07-23T09:14:31.000Z",
      },
    );

    const crashed = parseGameEndedV2({
      success: true,
      result: {
        sessionId: SERVER_SESSION_ID,
        status: "crashed",
        finalCheckpoint: "0",
        pointsAwarded: 0,
        seasonPointsTotal: 0,
        seasonId: null,
        division: "runner",
        ticketBalance: 2,
        endedAt: "2026-07-23T09:14:31.000Z",
      },
    });
    assert.equal(crashed.status, "CRASHED");
    assert.equal(crashed.seasonId, null);
    assert.equal(crashed.division, "RUNNER");
    assert.throws(
      () => parseGameEndedV2({ success: false }),
      /missing or invalid/i,
    );
  });

  it("rejects malformed server start payloads", () => {
    assert.throws(() => parseGameStartedV2(null), /missing or invalid/i);
    assert.throws(
      () => parseGameStartedV2({ success: false }),
      /missing or invalid/i,
    );
    assert.throws(
      () =>
        parseGameStartedV2({
          success: true,
          session: {
            sessionId: SERVER_SESSION_ID,
            clientSessionId: CLIENT_SESSION_ID,
            ticketCost: 2,
            ticketBalanceAfter: "6",
            division: "ROOKIE",
            startedAt: "not-a-date",
          },
          replayed: "false",
        }),
      /ticket cost/i,
    );
  });
});

describe("FE-08 season leaderboard domain", () => {
  it("keeps backend rank, zones, and viewer state authoritative", () => {
    const parsed = parseSeasonLeaderboard({
      success: true,
      season: {
        seasonNumber: 1,
        startsAt: "2026-07-01T00:00:00.000Z",
        endsAt: "2026-08-01T00:00:00.000Z",
        status: "ACTIVE",
      },
      division: "ROOKIE",
      standings: [
        {
          rank: 1,
          walletAddress: WALLET,
          points: 42,
          lastPointAt: "2026-07-20T10:00:00.000Z",
          zone: "PROMOTION",
          movement: null,
        },
      ],
      zones: {
        promotionCount: 1,
        relegationCount: 0,
        activePlayers: 12,
        smallDivision: true,
      },
      viewer: {
        walletAddress: WALLET,
        division: "ROOKIE",
        rank: 1,
        points: 42,
        zone: "PROMOTION",
      },
      total: 1,
      limit: 50,
      offset: 0,
    });

    assert.equal(parsed.season.status, "ACTIVE");
    assert.equal(parsed.standings[0].rank, 1);
    assert.equal(parsed.standings[0].zone, "PROMOTION");
    assert.equal(parsed.viewer?.points, 42);
    assert.equal(parsed.zones.smallDivision, true);
  });

  it("fails closed on malformed ranks and server-calculated zones", () => {
    assert.throws(
      () =>
        parseSeasonLeaderboard({
          success: true,
          season: {
            seasonNumber: 1,
            startsAt: "2026-07-01T00:00:00.000Z",
            endsAt: "2026-08-01T00:00:00.000Z",
            status: "ACTIVE",
          },
          division: "ROOKIE",
          standings: [
            {
              rank: 0,
              walletAddress: WALLET,
              points: 42,
              zone: "CLIENT_GUESSED",
            },
          ],
          zones: {
            promotionCount: 0,
            relegationCount: 0,
            activePlayers: 1,
            smallDivision: true,
          },
          viewer: null,
          total: 1,
          limit: 50,
          offset: 0,
        }),
      /season leaderboard/i,
    );
  });

  it("accepts nullable viewer rank and server movement history", () => {
    const parsed = parseSeasonLeaderboard({
      success: true,
      season: {
        seasonNumber: "2",
        startsAt: "2026-08-01T00:00:00.000Z",
        endsAt: "2026-09-01T00:00:00.000Z",
        status: "freezing",
      },
      division: "runner",
      standings: [
        {
          rank: "1",
          walletAddress: WALLET.toUpperCase(),
          points: "9",
          lastPointAt: null,
          zone: "safe",
          movement: "promoted",
        },
      ],
      zones: {
        promotionCount: 0,
        relegationCount: 0,
        activePlayers: 1,
        smallDivision: false,
      },
      viewer: {
        walletAddress: WALLET,
        division: "runner",
        rank: null,
        points: 0,
        zone: "passive",
      },
      total: 1,
      limit: 100,
      offset: 0,
    });

    assert.equal(parsed.season.status, "FREEZING");
    assert.equal(parsed.standings[0].lastPointAt, null);
    assert.equal(parsed.standings[0].movement, "PROMOTED");
    assert.equal(parsed.viewer?.rank, null);
    assert.equal(parsed.zones.smallDivision, false);
  });

  it("wraps malformed leaderboard shapes in one public error", () => {
    assert.throws(
      () => parseSeasonLeaderboard({ success: true, standings: [] }),
      /Season leaderboard is invalid/i,
    );
    assert.throws(
      () =>
        parseSeasonLeaderboard({
          success: true,
          season: {
            seasonNumber: 1,
            startsAt: "bad",
            endsAt: "2026-09-01T00:00:00.000Z",
            status: "ACTIVE",
          },
          division: "ROOKIE",
          standings: [],
          zones: {
            promotionCount: 0,
            relegationCount: 0,
            activePlayers: 0,
            smallDivision: true,
          },
          viewer: null,
          total: 0,
          limit: 50,
          offset: 0,
        }),
      /season start time/i,
    );
  });
});
