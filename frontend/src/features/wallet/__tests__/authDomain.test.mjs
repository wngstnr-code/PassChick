import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSiweMessage,
  selectBackendAuthRoute,
  signSiweMessage,
} from "../authDomain.ts";

const ACCOUNT = "0x1111111111111111111111111111111111111111";

describe("wallet backend auth routing", () => {
  it("keeps MiniPay on its no-signature endpoint", () => {
    assert.deepEqual(
      selectBackendAuthRoute({
        isMiniPay: true,
        embeddedAuthProvider: "google",
      }),
      { method: "minipay" },
    );
  });

  it("allows only confirmed AppKit embedded wallets to use social auth", () => {
    for (const provider of ["google", "apple", "discord", "x"]) {
      assert.deepEqual(
        selectBackendAuthRoute({
          isMiniPay: false,
          embeddedAuthProvider: provider,
        }),
        { method: "social", walletProvider: provider },
      );
    }

    assert.deepEqual(
      selectBackendAuthRoute({
        isMiniPay: false,
        embeddedAuthProvider: "email",
      }),
      { method: "social", walletProvider: "appkit" },
    );
  });

  it("routes MetaMask, injected, and external WalletConnect wallets to SIWE", () => {
    for (const walletProviderName of [
      "MetaMask",
      "EVM Wallet",
      "WalletConnect",
      "reown",
    ]) {
      assert.deepEqual(
        selectBackendAuthRoute({
          isMiniPay: false,
          embeddedAuthProvider: undefined,
          walletProviderName,
        }),
        { method: "siwe" },
      );
    }
  });
});

describe("SIWE message and signing", () => {
  it("builds an EIP-4361 message bound to the current origin, chain, and nonce", () => {
    const message = buildSiweMessage({
      address: ACCOUNT,
      chainId: 42220,
      nonce: "AbCd1234",
      origin: "https://pass-chick.example/play?mode=v2",
      issuedAt: "2026-07-23T09:12:00.000Z",
    });

    assert.equal(
      message,
      [
        "pass-chick.example wants you to sign in with your Ethereum account:",
        ACCOUNT,
        "",
        "Sign in to Pass Chick.",
        "",
        "URI: https://pass-chick.example",
        "Version: 1",
        "Chain ID: 42220",
        "Nonce: AbCd1234",
        "Issued At: 2026-07-23T09:12:00.000Z",
      ].join("\n"),
    );
  });

  it("rejects malformed SIWE inputs before opening the wallet signature prompt", () => {
    const validInput = {
      address: ACCOUNT,
      chainId: 42220,
      nonce: "AbCd1234",
      origin: "https://pass-chick.example",
      issuedAt: "2026-07-23T09:12:00.000Z",
    };

    assert.throws(
      () => buildSiweMessage({ ...validInput, address: "0x123" }),
      /wallet address/i,
    );
    assert.throws(
      () => buildSiweMessage({ ...validInput, nonce: "short" }),
      /nonce/i,
    );
    assert.throws(
      () => buildSiweMessage({ ...validInput, chainId: 0 }),
      /chain id/i,
    );
    assert.throws(
      () => buildSiweMessage({ ...validInput, origin: "file:///tmp/app" }),
      /origin/i,
    );
  });

  it("requests personal_sign from an external wallet with the SIWE message", async () => {
    const calls = [];
    const provider = {
      async request(request) {
        calls.push(request);
        return "0xsigned";
      },
    };

    assert.equal(
      await signSiweMessage(provider, "SIWE message", ACCOUNT),
      "0xsigned",
    );
    assert.deepEqual(calls, [
      {
        method: "personal_sign",
        params: ["SIWE message", ACCOUNT],
      },
    ]);
  });

  it("rejects an empty wallet signature", async () => {
    const provider = {
      async request() {
        return " ";
      },
    };

    await assert.rejects(
      () => signSiweMessage(provider, "SIWE message", ACCOUNT),
      /signature/i,
    );
  });
});
