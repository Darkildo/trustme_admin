import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "@/components/ui/toast-store";
import { api } from "@/lib/api";
import { qk } from "@/lib/queries";

export function useLogout() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: () => api.auth.logout(),
    onSettled: () => {
      qc.clear();
      qc.setQueryData(qk.me, null);
      toast.info(t("auth.loggedOut"));
      void navigate({ to: "/login", search: {} });
    },
  });
}
