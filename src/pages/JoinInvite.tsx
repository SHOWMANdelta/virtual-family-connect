import AuthPage from "@/pages/Auth";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { parseApiError } from "@/lib/errors";
import { useMutation, useQuery } from "convex/react";
import {
  AlertCircle,
  CalendarClock,
  Loader2,
  Video,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";

/** Shell used by every state of this page so the layout stays consistent. */
function InviteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,var(--color-primary)_0%,transparent_70%)] opacity-[0.07]"
      />
      <div className="relative flex min-h-screen items-center justify-center px-4 py-12">
        <div className="w-full max-w-[440px]">{children}</div>
      </div>
    </div>
  );
}

function TerminalState({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  const navigate = useNavigate();
  return (
    <InviteShell>
      <Card className="border-border/70 shadow-lg shadow-primary/5">
        <CardHeader className="text-center space-y-3">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
            {icon}
          </div>
          <div className="space-y-1.5">
            <CardTitle className="text-2xl tracking-tight">{title}</CardTitle>
            <CardDescription className="text-balance">
              {description}
            </CardDescription>
          </div>
        </CardHeader>
        <CardFooter className="flex-col gap-2">
          <Button className="w-full" onClick={() => navigate("/dashboard")}>
            Go to dashboard
          </Button>
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => navigate("/")}
          >
            Back to home
          </Button>
        </CardFooter>
      </Card>
    </InviteShell>
  );
}

export default function JoinInvite() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { isLoading: authLoading, isAuthenticated, user } = useAuth();

  const invite = useQuery(
    api.invites.getInviteByToken,
    token ? { token } : "skip",
  );
  const acceptInvite = useMutation(api.invites.acceptInvite);

  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAccept = async () => {
    if (!token) return;
    setJoining(true);
    setError(null);
    try {
      const { roomId } = await acceptInvite({ token });
      toast.success("You're in — connecting to the call");
      navigate(`/room/${roomId}`, { replace: true });
    } catch (caught) {
      const { message } = parseApiError(caught);
      setError(message);
      setJoining(false);
    }
  };

  if (!token) {
    return (
      <TerminalState
        icon={<XCircle className="h-7 w-7 text-muted-foreground" />}
        title="Invitation link incomplete"
        description="This link is missing its invitation code. Ask whoever invited you to send a fresh one."
      />
    );
  }

  // Loading the invite, or restoring the session.
  if (invite === undefined || authLoading) {
    return (
      <InviteShell>
        <div className="flex flex-col items-center gap-3 py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Checking your invitation…</p>
        </div>
      </InviteShell>
    );
  }

  switch (invite.state) {
    case "not_found":
      return (
        <TerminalState
          icon={<XCircle className="h-7 w-7 text-muted-foreground" />}
          title="Invitation not found"
          description="This link isn't valid. It may have been mistyped, or replaced by a newer invitation."
        />
      );
    case "revoked":
      return (
        <TerminalState
          icon={<XCircle className="h-7 w-7 text-muted-foreground" />}
          title="Invitation cancelled"
          description={`${invite.inviterName} cancelled this invitation, or sent a newer one. Check your inbox for the most recent email.`}
        />
      );
    case "expired":
      return (
        <TerminalState
          icon={<CalendarClock className="h-7 w-7 text-muted-foreground" />}
          title="Invitation expired"
          description={`This invitation to "${invite.roomName}" has expired. Ask ${invite.inviterName} to send a new one.`}
        />
      );
    case "room_gone":
      return (
        <TerminalState
          icon={<XCircle className="h-7 w-7 text-muted-foreground" />}
          title="Call no longer exists"
          description="The call this invitation pointed to has been removed."
        />
      );
    case "room_ended":
      return (
        <TerminalState
          icon={<CalendarClock className="h-7 w-7 text-muted-foreground" />}
          title="This call has ended"
          description={`"${invite.roomName}" is no longer active. Ask ${invite.inviterName} to start a new call.`}
        />
      );
  }

  // Signed out: sign in first, then come straight back to this page. Guest
  // sign-in works here too, so someone with no account can join in one click.
  if (!isAuthenticated) {
    return (
      <InviteShell>
        <div className="space-y-5">
          <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                <Video className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0 space-y-1">
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {invite.inviterName}
                  </span>{" "}
                  invited you to a video call
                </p>
                <p className="truncate text-lg font-semibold tracking-tight">
                  {invite.roomName}
                </p>
                {invite.state === "valid" && invite.note && (
                  <p className="border-l-2 border-primary/40 pl-3 text-sm italic text-muted-foreground">
                    "{invite.note}"
                  </p>
                )}
              </div>
            </div>
          </div>

          <AuthPage
            embedded
            redirectAfterAuth={`/join/${token}`}
            heading="Sign in to join"
            subheading="Use Google, your email, or join instantly as a guest."
          />
        </div>
      </InviteShell>
    );
  }

  const alreadyAccepted = invite.state === "accepted";
  const signedInAs = user?.name ?? user?.email;
  // Anonymous users have no email, so this only warns when we can actually tell.
  const differentAccount =
    !!user?.email &&
    user.email.toLowerCase() !== invite.invitedEmail.toLowerCase();

  return (
    <InviteShell>
      <Card className="border-border/70 shadow-lg shadow-primary/5">
        <CardHeader className="text-center space-y-3">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
            <Video className="h-7 w-7 text-primary" />
          </div>
          <div className="space-y-1.5">
            <CardTitle className="text-2xl tracking-tight">
              {alreadyAccepted ? "Rejoin the call" : "You're invited"}
            </CardTitle>
            <CardDescription className="text-balance">
              <span className="font-medium text-foreground">
                {invite.inviterName}
              </span>{" "}
              invited you to join{" "}
              <span className="font-medium text-foreground">
                {invite.roomName}
              </span>
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {invite.state === "valid" && invite.note && (
            <p className="border-l-2 border-primary/40 pl-3 text-sm italic text-muted-foreground">
              "{invite.note}"
            </p>
          )}

          {signedInAs && (
            <p className="text-center text-sm text-muted-foreground">
              Joining as{" "}
              <span className="font-medium text-foreground">{signedInAs}</span>
            </p>
          )}

          {differentAccount && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                This invitation was addressed to{" "}
                <span className="font-medium">{invite.invitedEmail}</span>. You can
                still join with your current account.
              </AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>

        <CardFooter className="flex-col gap-2">
          <Button
            size="lg"
            className="w-full font-medium"
            onClick={handleAccept}
            disabled={joining}
          >
            {joining ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Joining…
              </>
            ) : (
              <>
                <Video className="mr-2 h-4 w-4" />
                {alreadyAccepted ? "Rejoin the call" : "Accept & join call"}
              </>
            )}
          </Button>
          <Button
            variant="ghost"
            className="w-full"
            disabled={joining}
            onClick={() => navigate("/dashboard")}
          >
            Not now
          </Button>
        </CardFooter>
      </Card>
    </InviteShell>
  );
}
