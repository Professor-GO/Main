/** Composes the existing player portal and concept-art shell. */
import SiteShell from "./components/SiteShell/SiteShell";
import AuthPage from "./pages/AuthPage/AuthPage";

/** Keeps page workflows outside the application composition root. */
export default function App() {
  return (
    <SiteShell>
      <AuthPage />
    </SiteShell>
  );
}
