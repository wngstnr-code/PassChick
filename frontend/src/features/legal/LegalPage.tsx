import Link from "next/link";
import type { ReactNode } from "react";

type LegalSection = {
  heading: string;
  body: ReactNode;
};

type LegalPageProps = {
  title: string;
  updatedAt: string;
  sections: LegalSection[];
};

export function LegalPage({ title, updatedAt, sections }: LegalPageProps) {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#0a1428",
        color: "#e8ecf5",
        padding: "48px 20px 80px",
      }}
    >
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <Link
          href="/"
          style={{
            color: "#8fb4ff",
            textDecoration: "none",
            fontSize: 13,
          }}
        >
          ← Back to PassChick
        </Link>

        <h1
          style={{
            fontFamily: "'Press Start 2P', cursive",
            fontSize: 20,
            lineHeight: 1.6,
            margin: "28px 0 8px",
          }}
        >
          {title}
        </h1>
        <p style={{ opacity: 0.6, fontSize: 13, marginBottom: 32 }}>
          Last updated: {updatedAt}
        </p>

        {sections.map((section) => (
          <section key={section.heading} style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: 16, marginBottom: 8, color: "#fdd35c" }}>
              {section.heading}
            </h2>
            <div style={{ fontSize: 14, lineHeight: 1.7, opacity: 0.9 }}>
              {section.body}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
