import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import App from "../App";
import { StrictMode } from "react";

const player = {
  id: "player-1",
  username: "PlayerOne",
  createdAt: "2026-01-01T00:00:00Z",
  isActive: true,
  tokens: 50,
};
const question = {
  id: "attempt-1",
  source: "fallback",
  topic: "JavaScript",
  difficulty: "easy",
  question: "What is one plus one?",
  choices: ["Two", "Three", "Four", "Five"],
};
const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });

test("the lobby opens the professor inventory and returns with lobby focus", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string) =>
      Promise.resolve(
        path === "/api/auth/me"
          ? reply({ user: player })
          : reply({ inventory: [] }),
      ),
    ),
  );
  const user = userEvent.setup();
  render(<App />);
  await user.click(
    await screen.findByRole("button", { name: /View your professors/ }),
  );
  expect(
    await screen.findByRole("heading", { name: "No professors yet" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: /Back to lobby/ }));
  await waitFor(() =>
    expect(
      screen.getByRole("heading", { name: /Welcome to\s*the faculty/ }),
    ).toHaveFocus(),
  );
});

test("registration validates confirmation and preserves pending and error recovery", async () => {
  let finish!: (response: Response) => void;
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply({ message: "Sign in" }, 401))
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce(reply({ user: player }));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  await waitFor(() => expect(screen.getByLabelText("Username")).toBeEnabled());
  await user.click(screen.getByRole("tab", { name: "Create account" }));
  await user.type(screen.getByLabelText("Username"), "PlayerOne");
  await user.type(
    screen.getByLabelText("Password", { exact: true }),
    "password123",
  );
  await user.type(screen.getByLabelText("Confirm password"), "different");
  await user.click(
    screen.getByRole("button", { name: /Create your player account/ }),
  );
  expect(screen.getByLabelText("Confirm password")).toBeInvalid();
  expect(fetcher).toHaveBeenCalledTimes(1);
  await user.clear(screen.getByLabelText("Confirm password"));
  await user.type(screen.getByLabelText("Confirm password"), "password123");
  await user.click(
    screen.getByRole("button", { name: /Create your player account/ }),
  );
  expect(
    screen.getByRole("group", { name: "Player credentials" }),
  ).toBeDisabled();
  expect(screen.getByRole("tab", { name: "Log in" })).toBeDisabled();
  finish(reply({ message: "Username taken" }, 409));
  expect(await screen.findByRole("alert")).toHaveTextContent("Username taken");
  await user.click(
    screen.getByRole("button", { name: /Create your player account/ }),
  );
  expect(
    await screen.findByText("PlayerOne", { selector: "#player-name" }),
  ).toBeVisible();
  expect(fetcher.mock.calls[2][0]).toBe("/api/auth/register");
});

test("terminal answer failure offers next question without enabling an alternate answer", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply({ user: player }))
    .mockResolvedValueOnce(reply(question))
    .mockResolvedValueOnce(reply({ message: "Question expired" }, 410))
    .mockResolvedValueOnce(reply({ ...question, id: "attempt-2" }));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  await user.click(await screen.findByRole("button", { name: /Get tokens/ }));
  await user.click(await screen.findByRole("button", { name: /A\s*Two/ }));
  expect(await screen.findByText("Question expired")).toBeVisible();
  expect(screen.getByRole("button", { name: /A\s*Two/ })).toBeDisabled();
  expect(screen.getByRole("button", { name: /B\s*Three/ })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: /Next question/ }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /A\s*Two/ })).toBeEnabled(),
  );
  expect(fetcher).toHaveBeenCalledTimes(4);
});

test("restores session without stealing focus and logs out with username focus", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply({ user: player }))
    .mockResolvedValueOnce(reply({ message: "Logged out" }));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  expect(
    screen.getByRole("group", { name: "Player credentials" }),
  ).toBeDisabled();
  expect(
    await screen.findByText("PlayerOne", { selector: "#player-name" }),
  ).toBeVisible();
  expect(document.activeElement).not.toBe(
    screen.getByRole("heading", { name: /Welcome to\s*the faculty/ }),
  );
  await user.click(screen.getByRole("button", { name: /Log out/ }));
  await waitFor(() => expect(screen.getByLabelText("Username")).toHaveFocus());
  expect(screen.getByRole("status", { name: "" }).textContent).toContain(
    "logged out",
  );
});

test("recovers from session network failure, supports tabs and login with exact payload", async () => {
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(reply({ user: player }));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  expect(
    await screen.findByText(
      "The arena is taking a moment. You can try logging in below.",
    ),
  ).toBeVisible();
  await user.click(screen.getByRole("tab", { name: "Create account" }));
  expect(screen.getByLabelText("Confirm password")).toBeRequired();
  await user.keyboard("{Home}");
  expect(screen.getByRole("tab", { name: "Log in" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await user.type(screen.getByLabelText("Username"), "PlayerOne");
  await user.type(
    screen.getByLabelText("Password", { exact: true }),
    "correct-horse-42",
  );
  await user.click(screen.getByRole("button", { name: "Show password" }));
  expect(screen.getByLabelText("Password", { exact: true })).toHaveAttribute(
    "type",
    "text",
  );
  await user.click(screen.getByRole("button", { name: /Enter the arena/ }));
  expect(
    await screen.findByText("PlayerOne", { selector: "#player-name" }),
  ).toBeVisible();
  expect(fetcher.mock.calls[1][0]).toBe("/api/auth/login");
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
    username: "PlayerOne",
    password: "correct-horse-42",
  });
  expect(
    screen.getByRole("heading", { name: /Welcome to\s*the faculty/ }),
  ).toHaveFocus();
});

test("lost answer reply only allows manual same-choice retry and updates balance once", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply({ user: player }))
    .mockResolvedValueOnce(reply(question))
    .mockRejectedValueOnce(new Error("lost reply"))
    .mockResolvedValueOnce(
      reply({
        correct: true,
        answerIndex: 0,
        explanation: "Addition",
        tokensAwarded: 0,
        tokens: 51,
        alreadyAnswered: true,
      }),
    );
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  await user.click(await screen.findByRole("button", { name: /Get tokens/ }));
  await user.click(await screen.findByRole("button", { name: /A\s*Two/ }));
  expect(
    await screen.findByText(/Select your answer again to retry/),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: /B\s*Three/ })).toBeDisabled();
  expect(fetcher).toHaveBeenCalledTimes(3);
  await user.click(screen.getByRole("button", { name: /A\s*Two/ }));
  expect(
    await screen.findByText("Correct! Your token was already awarded."),
  ).toBeVisible();
  expect(fetcher.mock.calls[2][1].body).toBe(fetcher.mock.calls[3][1].body);
  expect(JSON.parse(fetcher.mock.calls[3][1].body)).toEqual({
    questionId: "attempt-1",
    selectedIndex: 0,
  });
  expect(screen.getByRole("button", { name: /Next question/ })).toHaveFocus();
  await user.click(screen.getByRole("button", { name: /Back to lobby/ }));
  expect(document.getElementById("account-tokens")).toHaveTextContent("51");
});
