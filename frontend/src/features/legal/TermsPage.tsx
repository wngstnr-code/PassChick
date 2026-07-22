import { LegalPage } from "./LegalPage";

export function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      updatedAt="July 22, 2026"
      sections={[
        {
          heading: "1. What PassChick Is",
          body: (
            <p>
              PassChick is a skill-based arcade game on Celo. In PassChick V2,
              each match uses 1 ticket instead of a cash stake. Your gameplay
              can earn season points, leaderboard position, divisions, badges,
              skins, and other rewards under the rules shown in the app.
            </p>
          ),
        },
        {
          heading: "2. Tickets",
          body: (
            <>
              <p>
                Tickets are an internal, non-transferable game balance. They
                are not an ERC-20 token, cannot be traded or sent to another
                wallet, and do not reset when a season ends.
              </p>
              <p>
                Tickets have no cash value and cannot be redeemed, withdrawn,
                or refunded for money. A completed ticket top-up is final,
                except where applicable law requires otherwise.
              </p>
            </>
          ),
        },
        {
          heading: "3. Getting & Using Tickets",
          body: (
            <p>
              You may receive tickets from daily claims, seasonal rewards,
              passport perks, or top-ups using supported stablecoins. The app
              shows the ticket amount and payment token before you approve a
              top-up. Blockchain transactions are irreversible, so review the
              wallet confirmation carefully. Each started match consumes 1
              ticket under the active game rules.
            </p>
          ),
        },
        {
          heading: "4. Seasons & Leaderboards",
          body: (
            <p>
              Season points depend on checkpoint performance and the division
              rules displayed in the app. Rankings may use achievement time as
              a tie-breaker. At season close, eligible players may be promoted,
              demoted, or receive rewards. Tickets do not reset with season
              points. We may correct results affected by fraud, exploits,
              outages, or invalid game sessions.
            </p>
          ),
        },
        {
          heading: "5. Rewards & Verified-Human Checks",
          body: (
            <p>
              Reward types and amounts may vary by season and are not
              guaranteed until announced and funded. Non-monetary rewards may
              include tickets, skins, badges, or titles. Claiming a monetary
              reward may require an eligible Trust Passport and verified-human
              status through Self.xyz. Failure to meet a published eligibility
              rule may prevent a monetary claim without affecting eligible
              non-monetary rewards.
            </p>
          ),
        },
        {
          heading: "6. Wallets, Legacy Vault & Network Risk",
          body: (
            <p>
              You control your wallet and approve your own transactions.
              PassChick cannot reverse blockchain transactions or recover lost
              wallet credentials. Legacy GameVault users retain access to
              withdraw available balances; the legacy vault is not a source of
              V2 tickets. Network fees, smart-contract failures, wallet errors,
              and third-party outages may delay or prevent an action.
            </p>
          ),
        },
        {
          heading: "7. Fair Play & Eligibility",
          body: (
            <p>
              You must comply with the laws and age requirements that apply to
              you. Do not use bots, multiple accounts to evade limits,
              automation, exploits, collusion, or other unfair methods. We may
              reject invalid sessions, restrict access, or disqualify rewards
              when reasonably necessary to protect players and the game.
            </p>
          ),
        },
        {
          heading: "8. Availability & Changes",
          body: (
            <p>
              PassChick is provided on an “as available” basis. Features,
              ticket sources, season rules, supported tokens, and rewards may
              change. Material changes will be presented in the app or these
              terms. Continued use after an update means you accept the revised
              terms.
            </p>
          ),
        },
        {
          heading: "9. Contact",
          body: (
            <p>
              Questions or issues: reach us on Telegram at{" "}
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
