/** Mounts the client application and its global visual primitives. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import "./styles/tokens.css";
import "./styles/reset.css";
import "./styles/shared.css";

const root = document.getElementById("root");
if (!root) throw new Error("The application mount point is missing.");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
