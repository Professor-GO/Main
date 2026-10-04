import { capsuleColorFor, createGlobe, revealPrize, wait } from "./gashapon.js";

const $ = (selector) => document.querySelector(selector);
const form = $("#auth-form");
const fields = $("#auth-fields");
const usernameInput = $("#username");
const passwordInput = $("#password");
const confirmInput = $("#confirm-password");
const tabs = [$("#login-tab"), $("#signup-tab")];
const questionCard = $("#question-card");
const questionChoices = $("#question-choices");
const questionStatus = $("#question-status");
const questionNext = $("#question-next");
let mode = "login";
let pending = false;
let restoring = true;
let questionPending = false;
let answerPending = false;
// The logged-in player's token balance, kept up to date after quizzes and pulls.
let tokens = 0;
// Tokens per pull; replaced with the server's value from /api/gacha/pool.
let pullCost = 10;
let pullPending = false;
// Pulls in a row a player can make without an Epic or Legendary before one is guaranteed;
// replaced with the server's value from /api/gacha/pity.
let pityGoal = 10;
// The gashapon globe, created the first time the recruit page opens.
let globe;

// Formats a whole number for display, such as 1,250.
const formatNumber = (value) => new Intl.NumberFormat().format(value);

// Shows a new token balance everywhere it appears.
function setTokens(value) {
    tokens = value;
    $("#account-tokens").textContent = formatNumber(value);
    $("#recruit-tokens").textContent = formatNumber(value);
    updatePullButton();
}

function showMessage(element, message = "") {
    element.textContent = message;
    element.hidden = !message;
}

function setBusy(busy) {
    pending = busy;
    fields.disabled = busy || restoring;
    form.setAttribute("aria-busy", String(busy));
    tabs.forEach((tab) => { tab.disabled = busy; });
    $("#submit-label").textContent = busy
        ? (mode === "login" ? "Entering the arena…" : "Creating your account…")
        : (mode === "login" ? "Enter the arena" : "Create your player account");
}

function setMode(nextMode) {
    if (pending) return;
    mode = nextMode;
    const signup = mode === "register";
    tabs.forEach((tab, index) => {
        const selected = index === (signup ? 1 : 0);
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
    });
    $("#auth-panel").setAttribute("aria-labelledby", signup ? "signup-tab" : "login-tab");
    $("#confirm-field").hidden = !signup;
    $("#username-hint").hidden = !signup;
    $("#password-hint").hidden = !signup;
    confirmInput.required = signup;
    confirmInput.value = "";
    confirmInput.setCustomValidity("");
    passwordInput.autocomplete = signup ? "new-password" : "current-password";
    passwordInput.placeholder = signup ? "Create a strong password" : "Enter your password";
    $("#form-intro").textContent = signup ? "A new semester. A new contender. Let’s get you in." : "Welcome back. Your faculty awaits.";
    $("#form-note").textContent = signup ? "Pick your player name. Your campus story starts here." : "Good to see you again. Let’s make the dean’s list.";
    showMessage($("#form-message"));
    setBusy(false);
}

async function api(path, body, prefix = "/api/auth") {
    let response;
    try {
        response = await fetch(`${prefix}/${path}`, {
            method: body === undefined ? "GET" : "POST",
            credentials: "same-origin",
            cache: "no-store",
            ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
            signal: AbortSignal.timeout(12_000),
        });
    } catch {
        throw new Error("We couldn’t reach the arena. Check your connection and try again.");
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(result.message ?? "Something went wrong. Please try again."), { status: response.status });
    return result;
}

function showLobby(user, focus = true) {
    $("#player-name").textContent = user.username;
    $("#pass-name").textContent = user.username;
    $("#player-initial").textContent = user.username[0].toUpperCase();
    $("#account-date").textContent = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(user.createdAt));
    $("#account-status").textContent = user.isActive ? "Active" : "Inactive";
    setTokens(user.tokens);
    $("#auth-view").hidden = true;
    $("#question-view").hidden = true;
    $("#recruit-view").hidden = true;
    $("#lobby-view").hidden = false;
    showMessage($("#lobby-message"));
    $("#lobby-status").textContent = "";
    form.reset();
    resetPasswordVisibility();
    document.title = `${user.username} · Professor-Go`;
    if (focus) $("#lobby-title").focus();
}

function resetPasswordVisibility() {
    passwordInput.type = "password";
    $("#toggle-password").textContent = "Show";
    $("#toggle-password").setAttribute("aria-label", "Show password");
    $("#toggle-password").setAttribute("aria-pressed", "false");
}

// Shows the Get tokens page with a fresh question.
function openQuestionPage() {
    $("#lobby-view").hidden = true;
    $("#question-view").hidden = false;
    document.title = "Pop quiz · Professor-Go";
    $("#question-title").focus();
    void loadCodingQuestion();
}

// Goes back from the Get tokens page to the lobby.
function closeQuestionPage() {
    $("#question-view").hidden = true;
    $("#lobby-view").hidden = false;
    document.title = `${$("#player-name").textContent} · Professor-Go`;
    $("#lobby-title").focus();
}

// Shows a question and its answer choices, labelled A, B, C, D.
function renderQuestion(question) {
    $("#question-meta").textContent = `${question.topic} · ${question.difficulty} · ${question.source === "gemini" ? "Gemini" : "Local fallback"}`;
    $("#question-body").textContent = question.question;
    questionChoices.replaceChildren(...question.choices.map((choice, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "choice-button";
        const letter = document.createElement("span");
        letter.className = "choice-letter";
        letter.textContent = String.fromCharCode(65 + index);
        const text = document.createElement("span");
        text.className = "choice-text";
        text.textContent = choice;
        button.append(letter, text);
        button.addEventListener("click", () => answerQuestion(question, index));
        return button;
    }));
    $("#question-feedback").hidden = true;
    questionCard.hidden = false;
    questionStatus.textContent = question.message ?? "";
}

// Saves the answer on the server, then shows its result and the updated token balance.
async function answerQuestion(question, chosen) {
    if (answerPending) return;
    answerPending = true;
    const buttons = [...questionChoices.children];
    buttons.forEach((button) => { button.disabled = true; });
    $("#question-back").disabled = true;
    questionStatus.textContent = "Checking your answer…";
    try {
        const result = await api("question/answer", { questionId: question.id, selectedIndex: chosen }, "/api");
        buttons.forEach((button, index) => {
            if (index === result.answerIndex) button.classList.add("is-correct");
            else if (index === chosen) button.classList.add("is-wrong");
        });
        $("#question-result").textContent = result.correct
            ? (result.tokensAwarded === 1 ? "Correct! +1 token." : "Correct! Your token was already awarded.")
            : `Not quite. The answer is ${String.fromCharCode(65 + result.answerIndex)}. No tokens earned.`;
        setTokens(result.tokens);
        $("#question-explanation").textContent = result.explanation;
        $("#question-explanation").hidden = !result.explanation;
        $("#question-feedback").hidden = false;
        questionStatus.textContent = `Your balance: ${formatNumber(result.tokens)} tokens.`;
        questionNext.hidden = false;
        questionNext.focus();
    } catch (error) {
        questionStatus.textContent = error.message;
        if (!error.status || error.status >= 500) {
            // Retry the same choice if the reply was lost; the server cannot award twice.
            buttons[chosen].disabled = false;
            questionStatus.textContent += " Select your answer again to retry.";
        } else {
            questionNext.hidden = false;
        }
    } finally {
        answerPending = false;
        $("#question-back").disabled = false;
    }
}

async function loadCodingQuestion() {
    if (questionPending || answerPending) return;
    questionPending = true;
    questionCard.hidden = true;
    questionNext.hidden = true;
    questionStatus.textContent = "Summoning a coding question…";
    try {
        renderQuestion(await api("question", undefined, "/api"));
    } catch (error) {
        questionStatus.textContent = error.message;
        questionNext.hidden = false;
    } finally {
        questionPending = false;
    }
}

// Shows the recruit page with the gashapon machine.
function openRecruitPage() {
    $("#lobby-view").hidden = true;
    $("#recruit-view").hidden = false;
    document.title = "Recruit · Professor-Go";
    $("#recruit-title").focus();
    globe ??= createGlobe($("#machine-balls"));
    $("#recruit-status").textContent = "";
    updatePullButton();
    api("gacha/pity", undefined, "/api").then((reply) => {
        const { pulls, goal } = toShownPity(reply);
        pityGoal = goal;
        showPity(pulls);
    }).catch(() => {});
    // The pull cost lives on the server; ask for it in case it has changed.
    api("gacha/pool", undefined, "/api").then((pool) => {
        pullCost = pool.cost;
        $("#recruit-cost").textContent = formatNumber(pool.cost);
        updatePullButton();
    }).catch(() => {});
}

// Goes back from the recruit page to the lobby.
function closeRecruitPage() {
    $("#recruit-view").hidden = true;
    $("#lobby-view").hidden = false;
    document.title = `${$("#player-name").textContent} · Professor-Go`;
    $("#lobby-title").focus();
}

// Shows the pull cost on the pull button, and disables it while pulling or when the player can't afford a pull.
function updatePullButton() {
    $("#pull-button").disabled = pullPending || tokens < pullCost;
    $("#pull-label").textContent = pullPending ? "Recruiting…"
        : tokens < pullCost ? `You need ${formatNumber(pullCost)} tokens to pull`
        : `Pull for ${formatNumber(pullCost)} tokens`;
}

// Creates one stat for the prize card, such as "ATK 46".
function statItem(name, value) {
    const item = document.createElement("div");
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    term.textContent = name;
    detail.textContent = String(value);
    item.append(term, detail);
    return item;
}

// Turns the server's reply to a pull into what the recruit page shows. This is the only
// code that reads the pull reply, so if the backend's reply changes, only this needs updating.
// The professor and cage both come from the gacha system (BackEnd/Professor Gacha System/gacha.ts).
// Returns { tokens, professor, cage, pityPulls }:
//   professor: { name, image, rarity, department, stats: { health, attack, defense, speed },
//                isNew, copies, level, copiesToLevelUp }
//   cage: { id, name, image }, the cage the professor arrives in
//   pityPulls: pulls in a row without an Epic or Legendary, after this pull
function toShownPrize(reply) {
    const { professor, copies, level } = reply.item;
    return {
        tokens: reply.user.tokens,
        professor: { ...professor, isNew: reply.isNew, copies, level },
        cage: professor.cage,
        pityPulls: reply.pity.epic,
    };
}

// Turns the server's reply from GET /api/gacha/pity into { pulls, goal }: the player's pulls
// in a row without an Epic or Legendary, and how many guarantee one.
function toShownPity(reply) {
    return { pulls: reply.pity.epic, goal: reply.epicPity };
}

// Fills the pity bar: one segment per pull without an Epic or Legendary. When the bar is
// full except for the last segment, the next pull is guaranteed to be Epic or Legendary.
function showPity(pulls) {
    const left = Math.max(1, pityGoal - pulls);
    const bar = $("#pity-bar");
    bar.style.setProperty("--segments", String(pityGoal));
    bar.setAttribute("aria-valuemax", String(pityGoal));
    bar.setAttribute("aria-valuenow", String(pulls));
    $("#pity-fill").style.width = `${Math.min(pulls / pityGoal, 1) * 100}%`;
    $("#pity-count").textContent = `${pulls} / ${pityGoal}`;
    $("#pity-note").textContent = left === 1
        ? "Your next pull is a guaranteed Epic or Legendary professor!"
        : `An Epic or Legendary professor is guaranteed within ${left} pulls.`;
    $("#pity-meter").classList.toggle("is-ready", left === 1);
    $("#pity-meter").hidden = false;
}

// Fills in the card under the machine that describes the professor the player just pulled.
function showPrizeCard({ professor, cage }) {
    const needed = professor.copiesToLevelUp + 1 - professor.copies;
    $("#prize-card").dataset.rarity = professor.rarity;
    $("#prize-meta").textContent = `${professor.rarity} · ${professor.department} · ${cage.name}`;
    $("#prize-name").textContent = professor.name;
    $("#prize-detail").textContent = professor.isNew
        ? "New recruit! They’ve joined your faculty."
        : `Another copy! You have ${formatNumber(professor.copies)} copies at level ${professor.level}. ${needed > 0 ? `${needed} more to level up.` : "Ready to level up!"}`;
    const { health, attack, defense, speed } = professor.stats;
    $("#prize-stats").replaceChildren(statItem("HP", health), statItem("ATK", attack), statItem("DEF", defense), statItem("SPD", speed));
    $("#prize-card").hidden = false;
}

// Pulls once: the capsules mix while the server picks the prize, then the prize's capsule
// drops out of the machine and opens.
async function pullGacha() {
    if (pullPending || tokens < pullCost) return;
    pullPending = true;
    updatePullButton();
    $("#recruit-back").disabled = true;
    $("#recruit-status").textContent = "";
    $("#prize-card").hidden = true;
    $("#gacha-reveal").hidden = true;
    const machine = $("#gacha-machine");
    globe.refill();
    machine.classList.add("is-mixing");
    globe.mix();
    try {
        // Mix for at least 2 seconds, even if the server answers sooner.
        const [reply] = await Promise.all([api("gacha/pull", {}, "/api"), wait(2000)]);
        const prize = toShownPrize(reply);
        setTokens(prize.tokens);
        machine.classList.remove("is-mixing");
        globe.settle();
        globe.takeBall(capsuleColorFor(prize));
        await revealPrize({
            stage: $("#gacha-stage"), machine, overlay: $("#gacha-reveal"), capsule: $("#reveal-capsule"),
            top: $("#capsule-top"), bottom: $("#capsule-bottom"), burst: $("#reveal-burst"),
            prizeBox: $("#reveal-prize"), professorImage: $("#prize-professor"), cageImage: $("#prize-cage"),
        }, prize);
        showPrizeCard(prize);
        // Updated only after the reveal, so the bar emptying doesn't give away an Epic or Legendary.
        showPity(prize.pityPulls);
        $("#recruit-status").textContent = `Your balance: ${formatNumber(prize.tokens)} tokens.`;
    } catch (error) {
        $("#recruit-status").textContent = error.message;
    } finally {
        machine.classList.remove("is-mixing");
        globe.settle();
        pullPending = false;
        updatePullButton();
        $("#recruit-back").disabled = false;
    }
}

tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => setMode(index === 0 ? "login" : "register"));
    tab.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - index;
        tabs[next].focus();
        setMode(next === 0 ? "login" : "register");
    });
});

$("#toggle-password").addEventListener("click", () => {
    const show = passwordInput.type === "password";
    passwordInput.type = show ? "text" : "password";
    $("#toggle-password").textContent = show ? "Hide" : "Show";
    $("#toggle-password").setAttribute("aria-label", show ? "Hide password" : "Show password");
    $("#toggle-password").setAttribute("aria-pressed", String(show));
});

[passwordInput, confirmInput].forEach((input) => input.addEventListener("input", () => confirmInput.setCustomValidity("")));
form.addEventListener("input", () => showMessage($("#form-message")));
form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (pending || restoring) return;
    if (mode === "register" && passwordInput.value !== confirmInput.value) {
        confirmInput.setCustomValidity("Your passwords don’t match yet.");
        confirmInput.reportValidity();
        return;
    }
    showMessage($("#form-message"));
    $("#session-status").textContent = "";
    setBusy(true);
    try {
        const result = await api(mode, { username: usernameInput.value.trim(), password: passwordInput.value });
        showLobby(result.user);
    } catch (error) {
        showMessage($("#form-message"), error.message);
    } finally {
        setBusy(false);
    }
});

$("#recruit-button").addEventListener("click", openRecruitPage);
$("#recruit-back").addEventListener("click", closeRecruitPage);
$("#pull-button").addEventListener("click", () => { void pullGacha(); });
// Placeholder until the battle page is designed.
$("#battle-button").addEventListener("click", () => {
    $("#lobby-status").textContent = "The battle arena is still being built. Check back soon!";
});
$("#tokens-button").addEventListener("click", openQuestionPage);
$("#question-back").addEventListener("click", closeQuestionPage);
questionNext.addEventListener("click", () => { void loadCodingQuestion(); });

$("#logout-button").addEventListener("click", async () => {
    const button = $("#logout-button");
    button.disabled = true;
    try {
        await api("logout", {});
        $("#lobby-view").hidden = true;
        $("#auth-view").hidden = false;
        document.title = "Professor-Go — Class is in session";
        setMode("login");
        $("#session-status").textContent = "You’re logged out. See you next class.";
        usernameInput.focus();
    } catch (error) {
        showMessage($("#lobby-message"), error.message);
    } finally {
        button.disabled = false;
    }
});

const dialog = $("#how-dialog");
$("#how-to-play").addEventListener("click", () => dialog.showModal());
$("#close-dialog").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });

async function restoreSession() {
    try {
        const result = await api("me");
        showLobby(result.user, false);
        $("#session-status").textContent = "";
    } catch (error) {
        $("#session-status").textContent = error.status === 401 ? "" : "The arena is taking a moment. You can try logging in below.";
    } finally {
        restoring = false;
        setBusy(false);
    }
}
restoreSession();
