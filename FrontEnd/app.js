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
    $("#account-tokens").textContent = new Intl.NumberFormat().format(user.tokens);
    $("#auth-view").hidden = true;
    $("#question-view").hidden = true;
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
        $("#account-tokens").textContent = new Intl.NumberFormat().format(result.tokens);
        $("#question-explanation").textContent = result.explanation;
        $("#question-explanation").hidden = !result.explanation;
        $("#question-feedback").hidden = false;
        questionStatus.textContent = `Your balance: ${new Intl.NumberFormat().format(result.tokens)} tokens.`;
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

// Placeholders until the recruitment and battle pages are designed.
$("#recruit-button").addEventListener("click", () => {
    $("#lobby-status").textContent = "The recruitment hall is still being built. Check back soon!";
});
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
