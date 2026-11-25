import { createFileRoute } from "@tanstack/react-router";
import { FugaGame } from "@/game/FugaGame";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <FugaGame />;
}
