import { createServer } from "node:http";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { env } from "./config/env.js";
import { setupGameGateway } from "./gateway/gameGateway.js";
import { startBlockchainListener } from "./services/blockchainListener.js";
import { startRecoveryWorker } from "./services/recoveryWorker.js";
import { startSeasonScheduler } from "./services/seasonScheduler.js";
import { startRewardBatchWorker } from "./services/rewardBatchExecutor.js";
import { startSpendBatchWorker } from "./services/spendBatchExecutor.js";
import authRoutes from "./routes/auth.js";
import gameRoutes from "./routes/game.js";
import leaderboardRoutes from "./routes/leaderboard.js";
import playerRoutes from "./routes/player.js";
import passportRoutes from "./routes/passport.js";
import faucetRoutes from "./routes/faucet.js";
import vaultRoutes from "./routes/vault.js";
import ticketsRoutes from "./routes/tickets.js";
import { getActiveGameCount } from "./services/gameState.js";
import { readBackendSignerHealth } from "./services/opsHealth.js";
import {
  getOperatorAccount,
  isOperatorConfigured,
  isTicketVaultConfigured,
  readIsRegisteredOperator,
  readOperatorCeloBalance,
} from "./lib/celo.js";

const app = express();
app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || env.ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin not allowed by CORS: ${origin}`));
    },
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
// Reports operator-key health for TicketVault.creditBatch/spendBatch. Never
// throws - a mis-registered operator or an RPC hiccup should not take down
// /health, it should just be reported as part of the payload.
async function readOperatorHealth() {
  if (!isOperatorConfigured()) {
    return { configured: false, address: null, registered: null, celoBalance: null };
  }

  const account = getOperatorAccount();
  const address = account?.address ?? null;

  // Without a TicketVault address there is no contract to query `operators`
  // against — report the key as configured but skip the on-chain reads.
  if (!isTicketVaultConfigured()) {
    return { configured: true, address, registered: null, celoBalance: null };
  }

  try {
    const [registered, balanceWei] = await Promise.all([
      address ? readIsRegisteredOperator(address) : Promise.resolve(null),
      readOperatorCeloBalance(),
    ]);

    return {
      configured: true,
      address,
      registered,
      celoBalance: balanceWei.toString(),
    };
  } catch (error) {
    return {
      configured: true,
      address,
      registered: null,
      celoBalance: null,
      error: String((error as { message?: string })?.message || error),
    };
  }
}

app.get("/health", async (_req, res) => {
  try {
    const backendSigner = await readBackendSignerHealth();
    const operator = await readOperatorHealth();

    res.json({
      status: backendSigner.healthy ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      activeGames: getActiveGameCount(),
      backendSigner,
      operator,
    });
  } catch (error) {
    console.error("❌ Failed to build health response:", error);
    res.status(500).json({
      status: "error",
      timestamp: new Date().toISOString(),
      activeGames: getActiveGameCount(),
    });
  }
});

app.use("/auth", authRoutes);
app.use("/api/game", gameRoutes);
app.use("/api/leaderboard", leaderboardRoutes);
app.use("/api/player", playerRoutes);
app.use("/api/passport", passportRoutes);
app.use("/api/faucet", faucetRoutes);
app.use("/api/vault", vaultRoutes);
app.use("/api/tickets", ticketsRoutes);
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

const httpServer = createServer(app);
const io = setupGameGateway(httpServer);

httpServer.listen(env.PORT, "0.0.0.0", () => {
  console.log("");
  console.log("════════════════════════════════════════════════════");
  console.log("  🐔 PassChick Backend");
  console.log("════════════════════════════════════════════════════");
  console.log(`  HTTP Server:    http://localhost:${env.PORT}`);
  console.log(`  WebSocket:      ws://localhost:${env.PORT}`);
  console.log(`  Health Check:   http://localhost:${env.PORT}/health`);
  console.log(`  Frontend CORS:  ${env.FRONTEND_URL}`);
  console.log("════════════════════════════════════════════════════");
  console.log("");

  startBlockchainListener().catch((err: unknown) => {
    console.error("⚠️  Blockchain listener failed to start:", err);
    console.log("   Backend continues without blockchain events.");
  });

  startRecoveryWorker();
  startSeasonScheduler();
  startRewardBatchWorker();
  startSpendBatchWorker();

  void readBackendSignerHealth()
    .then((backendSigner) => {
      const nativeDisplay = backendSigner.balanceNative.toFixed(6);
      console.log(
        `⛽ Backend signer: ${backendSigner.relayerAddress} | ${nativeDisplay} ${backendSigner.nativeSymbol}`
      );
      if (!backendSigner.healthy) {
        console.log(
          `⚠️  Backend signer balance is below recommended minimum (${backendSigner.minRecommendedNative} ${backendSigner.nativeSymbol}).`
        );
      }
    })
    .catch((error: unknown) => {
      console.error("⚠️  Failed to read backend signer health:", error);
    });
});

process.on("SIGINT", () => {
  console.log("\n🛑 Shutting down gracefully...");
  io.close();
  httpServer.close(() => {
    console.log("✅ Server closed.");
    process.exit(0);
  });
});

process.on("SIGTERM", () => {
  console.log("\n🛑 SIGTERM received. Shutting down...");
  io.close();
  httpServer.close(() => {
    process.exit(0);
  });
});
