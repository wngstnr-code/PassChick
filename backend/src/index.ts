import { createServer } from "node:http";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { env } from "./config/env.js";
import { setupGameGateway } from "./gateway/gameGateway.js";
import { startBlockchainListener } from "./services/blockchainListener.js";
import { startRecoveryWorker } from "./services/recoveryWorker.js";
import authRoutes from "./routes/auth.js";
import gameRoutes from "./routes/game.js";
import leaderboardRoutes from "./routes/leaderboard.js";
import playerRoutes from "./routes/player.js";
import passportRoutes from "./routes/passport.js";
import faucetRoutes from "./routes/faucet.js";
import vaultRoutes from "./routes/vault.js";
import { getActiveGameCount } from "./services/gameState.js";
import { readBackendSignerHealth } from "./services/opsHealth.js";

const app = express();
app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

app.use(
  cors({
    origin: env.FRONTEND_URL,
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.get("/health", async (_req, res) => {
  try {
    const backendSigner = await readBackendSignerHealth();

    res.json({
      status: backendSigner.healthy ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      activeGames: getActiveGameCount(),
      backendSigner,
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
