import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => import("../test/navigation-mock"));
vi.mock("next/link", () => import("../test/link-mock"));

import { MIN_PASSWORD_LENGTH } from "@/lib/auth";
import { resetRefreshForTests } from "@/lib/http";
import { getAccessToken, resetSessionForTests } from "@/lib/session";
import { resetNavigationMock, setSearchParams } from "@/test/navigation-mock";

import { InviteAcceptForm } from "./invite-accept-form";

const INVITE_TOKEN = "a".repeat(48);

const USER_PAYLOAD = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "invited@example.invalid",
  organization_id: "22222222-2222-4222-8222-222222222222",
  role: "member",
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** `token: null` leaves the code field alone, e.g. when the link prefilled it. */
async function fillForm({
  token = INVITE_TOKEN,
  name = "Ada Lovelace",
  password = "a-long-enough-password",
}: { token?: string | null; name?: string; password?: string } = {}) {
  if (token !== null) {
    const tokenField = screen.getByLabelText(/invitation code/i);
    await userEvent.clear(tokenField);
    if (token) await userEvent.type(tokenField, token);
  }
  await userEvent.type(screen.getByLabelText(/your name/i), name);
  await userEvent.type(screen.getByLabelText(/choose a password/i), password);
  await userEvent.click(screen.getByRole("button", { name: /accept invitation/i }));
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  resetSessionForTests();
  resetRefreshForTests();
  resetNavigationMock();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetSessionForTests();
  resetRefreshForTests();
});

describe("invitation acceptance", () => {
  it("prefills the code from the invitation link", () => {
    setSearchParams(`token=${INVITE_TOKEN}`);
    render(<InviteAcceptForm />);

    expect(screen.getByLabelText(/invitation code/i)).toHaveValue(INVITE_TOKEN);
  });

  it("stays usable when the link carried no code", () => {
    render(<InviteAcceptForm />);

    expect(screen.getByLabelText(/invitation code/i)).toHaveValue("");
    expect(screen.getByRole("button", { name: /accept invitation/i })).toBeEnabled();
  });

  it("posts the acceptance and confirms the account is ready", async () => {
    setSearchParams(`token=${INVITE_TOKEN}`);
    fetchMock.mockResolvedValue(jsonResponse(USER_PAYLOAD, 200));
    render(<InviteAcceptForm />);

    // The code came from the link; the reader only fills in the rest.
    await fillForm({ token: null });

    expect(
      await screen.findByRole("heading", { name: /invitation accepted/i }),
    ).toBeInTheDocument();

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://localhost:8000/v1/auth/invites/accept");
    expect(JSON.parse(init.body)).toEqual({
      token: INVITE_TOKEN,
      password: "a-long-enough-password",
      display_name: "Ada Lovelace",
    });
  });

  it("does not sign the reader in, and sends them to the login screen", async () => {
    fetchMock.mockResolvedValue(jsonResponse(USER_PAYLOAD, 200));
    render(<InviteAcceptForm />);

    await fillForm();
    await screen.findByRole("heading", { name: /invitation accepted/i });

    // Acceptance issues no session: the new password's first use is a login.
    expect(getAccessToken()).toBeNull();
    expect(screen.getByRole("link", { name: /go to sign in/i })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("names the invited address so the reader knows which account is ready", async () => {
    fetchMock.mockResolvedValue(jsonResponse(USER_PAYLOAD, 200));
    render(<InviteAcceptForm />);

    await fillForm();

    expect(await screen.findByRole("status")).toHaveTextContent("invited@example.invalid");
  });

  it("states the password rule before the reader submits", () => {
    render(<InviteAcceptForm />);

    expect(
      screen.getByText(new RegExp(`at least ${MIN_PASSWORD_LENGTH} characters`, "i")),
    ).toBeInTheDocument();
  });

  it("rejects a short password without a round trip", async () => {
    render(<InviteAcceptForm />);

    await fillForm({ password: "short" });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      new RegExp(`at least ${MIN_PASSWORD_LENGTH} characters`, "i"),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a truncated invitation code without a round trip", async () => {
    render(<InviteAcceptForm />);

    await fillForm({ token: "abc" });

    expect(await screen.findByRole("alert")).toHaveTextContent(/invitation code is not complete/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows fixed copy for a used invitation and never the backend's reason", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: "invitation 42 already consumed by user 7" }, 400),
    );
    render(<InviteAcceptForm />);

    await fillForm();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/not valid, has expired, or has already been used/i);
    expect(alert).not.toHaveTextContent(/invitation 42|user 7/i);
  });

  it("keeps the form available after a failure so the reader can retry", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: "nope" }, 400));
    render(<InviteAcceptForm />);

    await fillForm();
    await screen.findByRole("alert");

    expect(screen.getByRole("button", { name: /accept invitation/i })).toBeEnabled();
    expect(screen.getByLabelText(/your name/i)).toHaveValue("Ada Lovelace");
  });

  it("does not leave the chosen password in the DOM after success", async () => {
    fetchMock.mockResolvedValue(jsonResponse(USER_PAYLOAD, 200));
    const { container } = render(<InviteAcceptForm />);

    await fillForm();
    await screen.findByRole("heading", { name: /invitation accepted/i });

    expect(container.innerHTML).not.toContain("a-long-enough-password");
    expect(container.innerHTML).not.toContain(INVITE_TOKEN);
  });
});

describe("invitation accessibility", () => {
  it("labels every field and marks the new password for password managers", () => {
    render(<InviteAcceptForm />);

    expect(screen.getByLabelText(/invitation code/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/your name/i)).toHaveAttribute("autocomplete", "name");
    expect(screen.getByLabelText(/choose a password/i)).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
  });

  it("ties the password rule and any error to the password field", async () => {
    render(<InviteAcceptForm />);

    await fillForm({ password: "short" });
    const alert = await screen.findByRole("alert");

    const described =
      screen.getByLabelText(/choose a password/i).getAttribute("aria-describedby") ?? "";
    expect(described.split(/\s+/)).toContain(alert.id);
  });

  it("announces the accepted state in a live region", async () => {
    fetchMock.mockResolvedValue(jsonResponse(USER_PAYLOAD, 200));
    render(<InviteAcceptForm />);

    await fillForm();

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
  });
});
