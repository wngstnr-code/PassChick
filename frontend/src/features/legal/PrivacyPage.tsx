import { LegalPage } from "./LegalPage";

export function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updatedAt="Draft — review before publishing"
      sections={[
        {
          heading: "1. What We Collect",
          body: (
            <p>
              PassChick does not require accounts, emails, or personal
              information to play. The only identifier we use is your wallet
              address, which is public on the Celo blockchain by design.
            </p>
          ),
        },
        {
          heading: "2. On-Chain Data",
          body: (
            <p>
              Game sessions, vault deposits/withdrawals, and TrustPassport
              reputation are recorded on the Celo blockchain and are publicly
              viewable by anyone, independent of PassChick.
            </p>
          ),
        },
        {
          heading: "3. Analytics",
          body: (
            <p>
              We may use aggregated, anonymized on-chain data (via public
              dashboards such as Dune Analytics) to understand app usage.
              This data is derived entirely from public blockchain
              transactions, not private user data.
            </p>
          ),
        },
        {
          heading: "4. No Wallet Signing for Tracking",
          body: (
            <p>
              PassChick does not request message signatures for identity or
              tracking purposes. Wallet connections are used only to submit
              on-chain game and vault transactions.
            </p>
          ),
        },
        {
          heading: "5. Third Parties",
          body: (
            <p>
              We do not sell or share personal data with third parties,
              because we do not collect personal data beyond your public
              wallet address.
            </p>
          ),
        },
        {
          heading: "6. Contact",
          body: (
            <p>
              Questions about this policy: reach us on Telegram at{" "}
              <a
                href="https://t.me/passchick_support"
                style={{ color: "#8fb4ff" }}
              >
                @passchick_support
              </a>{" "}
              (placeholder — update with real handle before submission).
            </p>
          ),
        },
      ]}
    />
  );
}
