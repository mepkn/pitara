import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { Loader2Icon } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Shell } from "@/components/Shell";
import { SignInPage } from "@/components/SignInPage";

export default function App() {
  return (
    <TooltipProvider>
      <AuthLoading>
        <div className="grid min-h-svh place-items-center">
          <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
        </div>
      </AuthLoading>
      <Unauthenticated>
        <SignInPage />
      </Unauthenticated>
      <Authenticated>
        <Shell />
      </Authenticated>
      <Toaster />
    </TooltipProvider>
  );
}
