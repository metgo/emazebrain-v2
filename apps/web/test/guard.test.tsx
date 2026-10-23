/** The staff guard sends people where /v1/me says they belong. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { makeQueryClient, routes } from "../src/App.tsx";
import { PrefsProvider } from "../src/i18n/index.tsx";

function mockApi(handler: (path: string) => { status: number; body: unknown }) {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost");
    const { status, body } = handler(url.pathname + url.search);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
}

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <PrefsProvider initialLocale="en">
      <QueryClientProvider client={makeQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </PrefsProvider>,
  );
  return router;
}

afterEach(() => vi.unstubAllGlobals());

describe("staff guard", () => {
  it("sends a signed-out user to sign in, remembering where they were going", async () => {
    mockApi(() => ({ status: 401, body: { error: "unauthenticated" } }));
    const router = renderAt("/patients?q=noa");
    expect(await screen.findByRole("heading", { name: "Sign in", level: 1 })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/sign-in");
    expect(new URLSearchParams(router.state.location.search).get("next")).toBe("/patients?q=noa");
  });

  it("sends a user without two-step sign-in to enrolment", async () => {
    mockApi((p) => (p.startsWith("/api/auth/get-session") ? { status: 200, body: { session: { id: "s" }, user: { email: "a@synthetic.test", twoFactorEnabled: false } } } : { status: 403, body: { error: "mfa_required" } }));
    const router = renderAt("/today");
    expect(await screen.findByRole("heading", { name: "Set up two-step sign-in", level: 1 })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/setup-mfa");
  });

  it("shows the shell and the patient list in Hebrew, right to left", async () => {
    mockApi((p) => {
      if (p === "/v1/me") return { status: 200, body: { user: { id: "u", email: "y@synthetic.test", name: "Yael Bar" }, memberships: [{ clinic_id: "c1", organization_id: "o", role: "therapist", clinic_name: "Clinic" }] } };
      if (p.startsWith("/v1/patients")) return { status: 200, body: { patients: [{ id: "p1", clinic_id: "c1", given_name: "נועה", family_name: "כהן", date_of_birth: "2018-03-01", status: "active" }] } };
      return { status: 404, body: { error: "not_found" } };
    });
    localStorage.setItem("emb.locale", "he");
    const router = createMemoryRouter(routes, { initialEntries: ["/patients"] });
    render(
      <PrefsProvider>
        <QueryClientProvider client={makeQueryClient()}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </PrefsProvider>,
    );
    expect(await screen.findByRole("heading", { name: "מטופלים", level: 1 })).toBeInTheDocument();
    expect(document.documentElement.dir).toBe("rtl");
    expect(document.documentElement.lang).toBe("he");
    expect(await screen.findByRole("link", { name: "נועה כהן" })).toHaveAttribute("href", "/patients/p1");
    expect(screen.getByRole("navigation", { name: "ניווט ראשי" })).toBeInTheDocument();
    localStorage.clear();
  });
});
