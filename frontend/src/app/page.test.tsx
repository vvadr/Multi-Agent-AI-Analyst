import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Home from "./page";

/**
 * The landing page composes the workspace; the behaviour of each part is
 * covered by its own suite. These tests pin the composition and the scope
 * boundary — this is a local, unauthenticated demo, so no sign-in, account, or
 * run-history surface may appear here.
 *
 * `fetch` never resolves, so the readiness panel stays in its loading state and
 * no network behaviour leaks into these assertions.
 */
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Home", () => {
  it("keeps the backend readiness panel and its legend", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", { name: "Backend status" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/checking backend readiness/i)).toBeInTheDocument();
    expect(screen.getByText(/Reading this panel/i)).toBeInTheDocument();
  });

  it("offers the document uploader", () => {
    render(<Home />);

    expect(screen.getByLabelText(/choose a document/i)).toBeInTheDocument();
  });

  it("states the supported formats and limit next to the uploader", () => {
    render(<Home />);

    expect(
      screen.getByText(
        /PDF, DOCX, XLSX, TXT, Markdown, CSV, TSV, JSON, or HTML file up to 10 MB/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/not supported:/i)).toHaveTextContent(
      /password-protected PDFs/i,
    );
  });

  it("offers the question form", () => {
    render(<Home />);

    expect(screen.getByLabelText(/your question/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^ask$/i })).toBeInTheDocument();
  });

  it("describes the demo without promising persistence", () => {
    render(<Home />);

    expect(screen.getByText(/local, unauthenticated demo/i)).toBeInTheDocument();
    expect(
      screen.getByText(/never holds provider, database, or model secrets/i),
    ).toBeInTheDocument();
  });

  it("exposes no authentication, account, or run-history surface", () => {
    render(<Home />);

    expect(screen.queryByText(/sign in|log in|create account|sign up/i))
      .not.toBeInTheDocument();
    expect(screen.queryByLabelText(/password|email/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/run history|previous runs/i)).not.toBeInTheDocument();
  });

  it("mentions follow-up context without exposing a transcript", () => {
    render(<Home />);

    expect(
      screen.getByText(/follow-up questions can build on earlier questions/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /conversation|transcript|history/i }),
    ).not.toBeInTheDocument();
  });
});
