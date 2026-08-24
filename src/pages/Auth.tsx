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
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { parseAuthError } from "@/lib/errors";
import { useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Info,
  Loader2,
  Mail,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

const RESEND_COOLDOWN_SECONDS = 45;
const OTP_LENGTH = 6;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface AuthProps {
  /** Where to go once signed in. Defaults to "/dashboard". */
  redirectAfterAuth?: string;
  /** Render just the card, without the full-page wrapper (used by /join). */
  embedded?: boolean;
  heading?: string;
  subheading?: string;
}

/** Google's brand mark. Inline so there's no network request on the login page. */
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.44a5.51 5.51 0 0 1-2.39 3.62v3h3.86c2.26-2.08 3.61-5.15 3.61-8.81z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.08 7.95-2.91l-3.86-3a7.2 7.2 0 0 1-4.09 1.16 7.19 7.19 0 0 1-6.76-4.97H1.25v3.1A11.99 11.99 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.24 14.28a7.2 7.2 0 0 1 0-4.56v-3.1H1.25a11.99 11.99 0 0 0 0 10.76l3.99-3.1z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42A11.95 11.95 0 0 0 12 0 11.99 11.99 0 0 0 1.25 6.62l3.99 3.1A7.19 7.19 0 0 1 12 4.75z"
      />
    </svg>
  );
}

type Step = { name: "credentials" } | { name: "otp"; email: string };

/** Shape of `api.authProviders.availableProviders`. */
type ProviderInfo = {
  google: boolean;
  emailOtp: boolean;
  guest: boolean;
  emailDelivery: boolean;
  emailSandboxed: boolean;
  emailToConsole: boolean;
};

/**
 * Tell the user up front when email can't actually reach them.
 *
 * The sandbox case is the one that matters: a server holding a Resend key with no
 * verified domain looks fully configured and delivers to exactly one inbox,
 * silently failing for everyone else. Saying so before they type an address is
 * the difference between "this app is broken" and "this server needs setup".
 */
function DeliveryNotice({ providers }: { providers: ProviderInfo | undefined }) {
  if (!providers) return null;

  if (providers.emailToConsole) {
    return (
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Email isn't set up on this server, so your code is printed in the{" "}
          <code className="font-mono">convex dev</code> terminal instead of being
          sent.
        </AlertDescription>
      </Alert>
    );
  }

  if (!providers.emailDelivery) {
    return (
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          This server can't send email yet, so a code won't arrive. Use{" "}
          <span className="font-medium">Continue as guest</span>, or ask the site
          admin to finish email setup.
        </AlertDescription>
      </Alert>
    );
  }

  if (providers.emailSandboxed) {
    return (
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          This server is still using its email provider's test sender, which only
          delivers to the address that owns the provider account. Any other
          address won't receive a code — use{" "}
          <span className="font-medium">Continue as guest</span> instead.
        </AlertDescription>
      </Alert>
    );
  }

  return null;
}

function AuthCard({
  redirectAfterAuth = "/dashboard",
  embedded = false,
  heading = "Welcome back",
  subheading = "Sign in to join and host calls with your family and care team.",
}: AuthProps) {
  const { isLoading: authLoading, isAuthenticated, signIn } = useAuth();
  const navigate = useNavigate();
  const providers = useQuery(api.authProviders.availableProviders);

  const [step, setStep] = useState<Step>({ name: "credentials" });
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [pending, setPending] = useState<null | "google" | "email" | "guest" | "verify">(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  const submittedOtpRef = useRef<string | null>(null);

  // Redirect once the session is live. Driven off auth state rather than the
  // sign-in call site so OAuth returns and OTP verification behave identically.
  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigate(redirectAfterAuth, { replace: true });
    }
  }, [authLoading, isAuthenticated, navigate, redirectAfterAuth]);

  // Resend cooldown ticker.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const emailValid = EMAIL_PATTERN.test(email.trim());

  const requestCode = useCallback(
    async (address: string, isResend: boolean) => {
      setPending("email");
      setError(null);
      setNotice(null);
      try {
        await signIn("email-otp", { email: address });
        setStep({ name: "otp", email: address });
        setOtp("");
        submittedOtpRef.current = null;
        if (isResend) setNotice("We sent a new code.");
      } catch (caught) {
        setError(
          parseAuthError(
            caught,
            "We couldn't send a code to that address. Please check it and try again.",
          ),
        );
      } finally {
        // Start the cooldown whether or not the send succeeded. The server spends
        // a rate-limit slot the moment it's asked, so an immediate retry can't
        // help — it just burns the caller's allowance and makes the eventual
        // "try again in 12 minutes" arrive sooner. Editing the address clears the
        // cooldown, so fixing a typo is still instant.
        setCooldown(RESEND_COOLDOWN_SECONDS);
        setPending(null);
      }
    },
    [signIn],
  );

  const verifyCode = useCallback(
    async (code: string) => {
      if (step.name !== "otp") return;
      setPending("verify");
      setError(null);
      setNotice(null);
      try {
        await signIn("email-otp", { email: step.email, code });
        // The redirect effect takes over once the session lands.
      } catch (caught) {
        setError(
          parseAuthError(
            caught,
            "That code isn't right, or it has expired. Request a new one.",
          ),
        );
        setOtp("");
        submittedOtpRef.current = null;
        setPending(null);
      }
    },
    [signIn, step],
  );

  // Auto-submit as soon as six digits are present, so there's no extra click
  // after pasting a code. Guarded so a rejected code isn't retried on re-render.
  useEffect(() => {
    if (
      step.name === "otp" &&
      otp.length === OTP_LENGTH &&
      pending === null &&
      submittedOtpRef.current !== otp
    ) {
      submittedOtpRef.current = otp;
      void verifyCode(otp);
    }
  }, [otp, step, pending, verifyCode]);

  const handleGoogle = async () => {
    setPending("google");
    setError(null);
    try {
      await signIn("google", { redirectTo: redirectAfterAuth });
      // Browser navigates to Google; nothing further to do here.
    } catch (caught) {
      setError(
        parseAuthError(caught, "Google sign-in failed. Please try again."),
      );
      setPending(null);
    }
  };

  const handleGuest = async () => {
    setPending("guest");
    setError(null);
    try {
      await signIn("anonymous");
    } catch (caught) {
      setError(
        parseAuthError(
          caught,
          "Couldn't start a guest session. Please try again.",
        ),
      );
      setPending(null);
    }
  };

  const busy = pending !== null;

  // While the session is being restored, don't flash the form.
  if (authLoading || isAuthenticated) {
    const spinner = (
      <div className="flex flex-col items-center gap-3 py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Checking your session…</p>
      </div>
    );
    return embedded ? spinner : (
      <div className="min-h-screen flex items-center justify-center">{spinner}</div>
    );
  }

  const card = (
    <Card className="w-full max-w-[420px] border-border/70 shadow-lg shadow-primary/5">
      <AnimatePresence mode="wait" initial={false}>
        {step.name === "credentials" ? (
          <motion.div
            key="credentials"
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.18 }}
          >
            <CardHeader className="text-center space-y-3">
              <button
                type="button"
                onClick={() => navigate("/")}
                className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 transition-colors hover:bg-primary/15"
                aria-label="Back to home"
              >
                <ShieldCheck className="h-7 w-7 text-primary" />
              </button>
              <div className="space-y-1.5">
                <CardTitle className="text-2xl tracking-tight">{heading}</CardTitle>
                <CardDescription className="text-balance">
                  {subheading}
                </CardDescription>
              </div>
            </CardHeader>

            <CardContent className="space-y-5">
              {providers?.google && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className="w-full font-medium"
                    onClick={handleGoogle}
                    disabled={busy}
                  >
                    {pending === "google" ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <GoogleIcon className="mr-2 h-4 w-4" />
                    )}
                    Continue with Google
                  </Button>

                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t border-border" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase tracking-wider">
                      <span className="bg-card px-3 text-muted-foreground">or</span>
                    </div>
                  </div>
                </>
              )}

              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!emailValid || busy) return;
                  void requestCode(email.trim().toLowerCase(), false);
                }}
              >
                <div className="space-y-2">
                  <label
                    htmlFor="email"
                    className="text-sm font-medium text-foreground"
                  >
                    Email address
                  </label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      placeholder="you@example.com"
                      className="pl-9"
                      value={email}
                      disabled={busy}
                      onChange={(event) => {
                        setEmail(event.target.value);
                        if (error) setError(null);
                        // A different address is a different request, so don't
                        // make someone who mistyped wait out the cooldown.
                        setCooldown(0);
                      }}
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  size="lg"
                  className="w-full font-medium"
                  disabled={busy || !emailValid || cooldown > 0}
                >
                  {pending === "email" ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending code…
                    </>
                  ) : cooldown > 0 ? (
                    `Try again in ${cooldown}s`
                  ) : (
                    <>
                      Continue with email
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  We'll email you a 6-digit code. No password needed.
                </p>
              </form>

              <Button
                type="button"
                variant="ghost"
                size="lg"
                className="w-full font-medium"
                onClick={handleGuest}
                disabled={busy}
              >
                {pending === "guest" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <UserRound className="mr-2 h-4 w-4" />
                )}
                Continue as guest
              </Button>

              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <DeliveryNotice providers={providers} />
            </CardContent>
          </motion.div>
        ) : (
          <motion.div
            key="otp"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12 }}
            transition={{ duration: 0.18 }}
          >
            <CardHeader className="text-center space-y-3">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
                <Mail className="h-7 w-7 text-primary" />
              </div>
              <div className="space-y-1.5">
                <CardTitle className="text-2xl tracking-tight">
                  Enter your code
                </CardTitle>
                <CardDescription>
                  We sent a 6-digit code to{" "}
                  <span className="font-medium text-foreground">{step.email}</span>
                </CardDescription>
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="flex justify-center">
                <InputOTP
                  value={otp}
                  onChange={(value) => {
                    setOtp(value.replace(/\D/g, "").slice(0, OTP_LENGTH));
                    if (error) setError(null);
                  }}
                  maxLength={OTP_LENGTH}
                  disabled={pending === "verify"}
                  autoFocus
                >
                  <InputOTPGroup>
                    {Array.from({ length: OTP_LENGTH }).map((_, index) => (
                      <InputOTPSlot key={index} index={index} />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>

              {pending === "verify" && (
                <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Verifying…
                </p>
              )}

              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {notice && !error && (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>{notice}</AlertDescription>
                </Alert>
              )}

              {providers && <DeliveryNotice providers={providers} />}
            </CardContent>

            <CardFooter className="flex-col gap-2">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={cooldown > 0 || busy}
                onClick={() => void requestCode(step.email, true)}
              >
                {pending === "email" ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending…
                  </>
                ) : cooldown > 0 ? (
                  `Resend code in ${cooldown}s`
                ) : (
                  "Resend code"
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                disabled={pending === "verify"}
                onClick={() => {
                  setStep({ name: "credentials" });
                  setOtp("");
                  setError(null);
                  setNotice(null);
                  submittedOtpRef.current = null;
                }}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Use a different method
              </Button>
            </CardFooter>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );

  if (embedded) return card;

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      {/* Soft brand wash behind the card. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,var(--color-primary)_0%,transparent_70%)] opacity-[0.07]"
      />
      <div className="relative flex min-h-screen items-center justify-center px-4 py-12">
        <div className="w-full max-w-[420px] space-y-6">
          {card}
          <p className="text-center text-xs text-muted-foreground">
            By continuing you agree to take part in secure, private calls.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function AuthPage(props: AuthProps) {
  return <AuthCard {...props} />;
}
