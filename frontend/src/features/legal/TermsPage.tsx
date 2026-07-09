import { LegalPage } from "./LegalPage";

export function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      updatedAt="Draft — review before publishing"
      sections={[
        {
          heading: "1. What PassChick Is",
          body: (
            <p>
              PassChick is a skill-based arcade game on the Celo blockchain.
              Gameplay outcomes are determined by player skill, not chance.
              Session results, vault balances, and player reputation
              (TrustPassport) are recorded on-chain via smart contracts you
              interact with directly from your own wallet.
            </p>
          ),
        },
        {
          heading: "2. Non-Custodial",
          body: (
            <p>
              PassChick never takes custody of your funds. Deposits are held
              in an on-chain vault contract that only you can withdraw from
              using your own wallet. We cannot access, freeze, or move your
              funds on your behalf.
            </p>
          ),
        },
        {
          heading: "3. Supported Assets",
          body: (
            <p>
              PassChick currently supports USDC on Celo only. Sending any
              other asset to the app&apos;s contracts may result in permanent
              loss of funds.
            </p>
          ),
        },
        {
          heading: "4. Eligibility & Risk",
          body: (
            <p>
              You are responsible for complying with the laws of your
              jurisdiction. Blockchain transactions are irreversible and
              network fees are non-refundable. Use PassChick at your own
              risk.
            </p>
          ),
        },
        {
          heading: "5. Changes",
          body: (
            <p>
              We may update these terms as the product evolves. Continued use
              of PassChick after an update means you accept the revised
              terms.
            </p>
          ),
        },
        {
          heading: "6. Contact",
          body: (
            <p>
              Questions or issues: reach us on Telegram at{" "}
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
