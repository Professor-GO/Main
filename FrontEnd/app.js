const $ = (selector) => document.querySelector(selector);
const form = $("#auth-form");
const fields = $("#auth-fields");
const usernameInput = $("#username");
const passwordInput = $("#password");
const confirmInput = $("#confirm-password");
const tabs = [$("#login-tab"), $("#signup-tab")];
let mode = "login";
let pending = false;
let restoring = true;

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

async function api(path, body) {
    let response;
    try {
        response = await fetch(`/api/auth/${path}`, {
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
    $("#auth-view").hidden = true;
    $("#lobby-view").hidden = false;
    showMessage($("#lobby-message"));
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
