import { LegalPage } from "./LegalPage";

export function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updatedAt="July 22, 2026"
      sections={[
        {
          heading: "1. Data We Process",
          body: (
            <p>
              PassChick processes your public wallet address, network and
              transaction identifiers, ticket activity, gameplay results,
              season points, leaderboard position, Trust Passport data, reward
              eligibility, and security or diagnostic logs needed to operate
              the game. MiniPay and other wallet providers may process account
              information under their own privacy policies.
            </p>
          ),
        },
        {
          heading: "2. On-Chain Data",
          body: (
            <p>
              Ticket claims and purchases, supported reward claims, legacy
              vault transactions, and Trust Passport records may be written to
              Celo. Blockchain records are public, permanent, and independently
              viewable. PassChick cannot edit or delete confirmed on-chain
              records.
            </p>
          ),
        },
        {
          heading: "3. Gameplay & Service Data",
          body: (
            <p>
              We process off-chain session data to start matches, debit the
              authoritative ticket mirror, calculate checkpoint results,
              maintain leaderboards, prevent duplicate actions, detect abuse,
              and recover interrupted sessions. We may use aggregated or
              de-identified usage statistics to improve reliability and game
              balance.
            </p>
          ),
        },
        {
          heading: "4. Verified-Human Status",
          body: (
            <p>
              If you choose to claim a monetary reward, Self.xyz may verify
              that you are a unique eligible human. Self.xyz handles the
              identity-verification process under its own terms. PassChick is
              designed to receive a proof or verification result rather than
              your raw identity document, and may record verification status
              against your Trust Passport.
            </p>
          ),
        },
        {
          heading: "5. Sessions & Local Storage",
          body: (
            <p>
              The app may use session cookies or local browser storage to keep
              your wallet-linked backend session active, remember interface
              preferences, and protect requests from replay or impersonation.
              Clearing browser data may sign you out but does not erase public
              blockchain records.
            </p>
          ),
        },
        {
          heading: "6. Service Providers",
          body: (
            <p>
              We may share the minimum necessary data with infrastructure used
              to operate PassChick, including Celo nodes, wallet-connectivity
              providers, hosting and backend services, error monitoring, and
              Self.xyz when verification is requested. We do not sell personal
              data.
            </p>
          ),
        },
        {
          heading: "7. Retention & Security",
          body: (
            <p>
              We retain off-chain records for as long as needed to operate
              seasons, resolve disputes, prevent fraud, meet legal obligations,
              and maintain security. We use reasonable safeguards, but no
              internet or blockchain system can guarantee absolute security.
            </p>
          ),
        },
        {
          heading: "8. Your Choices",
          body: (
            <p>
              You may disconnect your wallet, clear local browser data, or stop
              using PassChick. You may contact us about off-chain information
              associated with your wallet. Requests cannot alter immutable
              blockchain records or data controlled independently by wallet,
              network, or verification providers.
            </p>
          ),
        },
        {
          heading: "9. Changes & Contact",
          body: (
            <p>
              We may update this policy as PassChick evolves. Questions or
              privacy requests: reach us on Telegram at{" "}
              <a href="https://t.me/passchick_support">
                @passchick_support
              </a>
              .
            </p>
          ),
        },
      ]}
    />
  );
}
