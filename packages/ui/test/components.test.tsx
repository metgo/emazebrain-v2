import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CalendarDays, House, MessageSquare, Menu, Users, BookOpen } from "lucide-react";
import { Alert, AppShell, Button, CodeField, DataList, Disclosure, TextField, initials, type ShellNavItem } from "../src/index.ts";
import { setViewportWidth } from "./setup.ts";

type Row = { id: string; name: string; age: number };
const rows: Row[] = [
  { id: "a", name: "Noa Levi", age: 7 },
  { id: "b", name: "Daniel Cohen", age: 9 },
];
const columns = [
  { id: "name", header: "Name", primary: true, cell: (r: Row) => r.name },
  { id: "age", header: "Age", numeric: true, cell: (r: Row) => r.age },
];

describe("DataList", () => {
  it("is a table on desktop with one link per row", () => {
    setViewportWidth(1280);
    render(<DataList rows={rows} columns={columns} getRowKey={(r) => r.id} caption="Patients" getRowHref={(r) => `/p/${r.id}`} />);
    const table = screen.getByRole("table", { name: "Patients" });
    expect(table).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Name", "Age"]);
    expect(screen.getByRole("link", { name: "Noa Levi" })).toHaveAttribute("href", "/p/a");
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("is a list of cards on a tablet, with the same links", () => {
    setViewportWidth(820);
    render(<DataList rows={rows} columns={columns} getRowKey={(r) => r.id} caption="Patients" getRowHref={(r) => `/p/${r.id}`} />);
    expect(screen.queryByRole("table")).toBeNull();
    const list = screen.getByRole("list", { name: "Patients" });
    expect(list.querySelectorAll("li")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Daniel Cohen" })).toHaveAttribute("href", "/p/b");
  });
});

describe("AppShell", () => {
  const items: ShellNavItem[] = [
    { id: "today", href: "/today", label: "Today", icon: House },
    { id: "patients", href: "/patients", label: "Patients", icon: Users },
    { id: "calendar", href: "/calendar", label: "Calendar", icon: CalendarDays },
    { id: "library", href: "/library", label: "Library", icon: BookOpen },
    { id: "messages", href: "/messages", label: "Messages", icon: MessageSquare, badge: 3, badgeLabel: "3 unread" },
  ];
  const more = { id: "more", href: "/more", label: "More", icon: Menu };

  it("marks the current page, keeps phone tabs to five and has a skip link", () => {
    render(
      <AppShell
        brand="eMazeBrain"
        navLabel="Main"
        tabsLabel="Tabs"
        items={items}
        tabIds={["today", "patients", "calendar", "messages", "library"]}
        more={more}
        isActive={(i) => i.id === "patients"}
        renderLink={({ href, className, children, ...rest }) => (
          <a href={href} className={className} {...rest}>
            {children}
          </a>
        )}
        topBar={null}
        skipLabel="Skip to content"
      >
        <p>content</p>
      </AppShell>,
    );
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main");
    const rail = screen.getByRole("navigation", { name: "Main" });
    expect(rail.querySelector('[aria-current="page"]')).toHaveTextContent("Patients");
    const tabs = screen.getByRole("navigation", { name: "Tabs" });
    expect(tabs.querySelectorAll("li")).toHaveLength(5);
    expect(tabs).toHaveTextContent("More");
    expect(rail).toHaveTextContent("3 unread");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main");
  });
});

describe("fields and feedback", () => {
  it("connects hint and error to the input", () => {
    render(<TextField label="Email" hint="Your work email" error="Enter an email address" />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Your work email Enter an email address");
  });

  it("code field supports autofill and numeric keyboards", () => {
    render(<CodeField label="Code" />);
    const input = screen.getByLabelText("Code");
    expect(input).toHaveAttribute("autocomplete", "one-time-code");
    expect(input).toHaveAttribute("inputmode", "numeric");
  });

  it("danger alerts interrupt, others are polite", () => {
    render(
      <>
        <Alert tone="danger" title="Wrong code" />
        <Alert tone="info" title="Saved" />
      </>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Wrong code");
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });

  it("a loading button is busy and can't be pressed twice", async () => {
    let clicks = 0;
    render(
      <Button loading onClick={() => clicks++}>
        Sign in
      </Button>,
    );
    const b = screen.getByRole("button", { name: "Sign in" });
    expect(b).toHaveAttribute("aria-busy", "true");
    await userEvent.click(b);
    expect(clicks).toBe(0);
  });

  it("takes initials from first and last names, in any script", () => {
    expect(initials("Noa Levi")).toBe("NL");
    expect(initials("נועה בת שבע לוי")).toBe("נל");
    expect(initials("Daniel")).toBe("D");
    expect(initials("  ")).toBe("?");
  });
});

describe("Disclosure", () => {
  it("opens, closes on Escape and returns focus to the button", async () => {
    const user = userEvent.setup();
    render(
      <Disclosure label="Account" trigger={<span aria-hidden="true">YB</span>}>
        {(close) => (
          <button type="button" onClick={close}>
            Sign out
          </button>
        )}
      </Disclosure>,
    );
    const trigger = screen.getByRole("button", { name: "Account" });
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    expect(trigger).toHaveFocus();
  });
});
