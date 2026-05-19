import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { usePageHeaderActions } from "@/context/PageHeaderContext";

export const Route = createFileRoute("/_authed/_shell/new")({
  component: NewThreadPage,
});

function NewThreadPage() {
  const navigate = useNavigate();
  usePageHeaderActions({ title: "Spaces", hideTopBar: true });
  useEffect(() => {
    void navigate({ to: "/spaces", replace: true });
  }, [navigate]);
  return null;
}
