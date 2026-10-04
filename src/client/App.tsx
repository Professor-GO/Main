/** Composes the existing player portal and concept-art shell. */
import SiteShell from "./components/SiteShell/SiteShell";
import PlayerPortal from "./pages/PlayerPortal";

/** Keeps page workflows outside the application composition root. */
export default function App() {
  return (
    <SiteShell>
      <PlayerPortal />
    </SiteShell>
  );
}
