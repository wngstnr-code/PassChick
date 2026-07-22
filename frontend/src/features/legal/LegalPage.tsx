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
    <>
      <a className="legal-skip-link" href="#legal-content">
        Skip to main content
      </a>
      <main id="legal-content" className="legal-page" tabIndex={-1}>
        <div className="legal-shell">
          <Link href="/" className="legal-back-link">
            <span aria-hidden="true">←</span> Back to PassChick
          </Link>

          <header className="legal-header">
            <h1>{title}</h1>
            <p>Last updated: {updatedAt}</p>
          </header>

          <div className="legal-sections">
            {sections.map((section) => (
              <section key={section.heading} className="legal-section">
                <h2>{section.heading}</h2>
                <div>{section.body}</div>
              </section>
            ))}
          </div>
        </div>
      </main>
    </>
  );
}
