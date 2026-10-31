import { Dashboard } from "@/components/Dashboard";
import { ToastProvider } from "@/components/Toast";

export default function Page() {
  return (
    <ToastProvider>
      <Dashboard />
    </ToastProvider>
  );
}
