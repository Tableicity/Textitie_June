import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { setTenantToken } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { MessageSquare, FlaskConical } from "lucide-react";
import peekImage from "@assets/landing-peek.png";

const PENDING_KEY = "sama_mfa_pending";
const EMAIL_KEY = "sama_mfa_email";

export function setMfaPending(token: string, maskedEmail: string) {
  sessionStorage.setItem(PENDING_KEY, token);
  sessionStorage.setItem(EMAIL_KEY, maskedEmail);
}

function getMfaPending() {
  return {
    token: sessionStorage.getItem(PENDING_KEY),
    maskedEmail: sessionStorage.getItem(EMAIL_KEY) ?? "",
  };
}

function clearMfaPending() {
  sessionStorage.removeItem(PENDING_KEY);
  sessionStorage.removeItem(EMAIL_KEY);
}

export default function Verify() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [isLoading, setIsLoading] = useState(false);
  const [resendIn, setResendIn] = useState(60);
  const [labCode, setLabCode] = useState<string | null>(null);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const { token: pendingToken, maskedEmail } = getMfaPending();

  useEffect(() => {
    if (!pendingToken) {
      setLocation("/login");
      return;
    }
    inputs.current[0]?.focus();
  }, [pendingToken, setLocation]);

  useEffect(() => {
    if (!pendingToken) return;
    let cancelled = false;
    async function fetchLabCode() {
      try {
        const res = await fetch(
          `/api/tenant-auth/lab-code?pendingToken=${encodeURIComponent(pendingToken!)}`,
        );
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && typeof data.code === "string") setLabCode(data.code);
      } catch {
        /* lab card stays hidden */
      }
    }
    void fetchLabCode();
    return () => {
      cancelled = true;
    };
  }, [pendingToken, resendIn]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  function setDigit(i: number, v: string) {
    const cleaned = v.replace(/\D/g, "").slice(0, 1);
    const next = [...digits];
    next[i] = cleaned;
    setDigits(next);
    if (cleaned && i < 5) inputs.current[i + 1]?.focus();
    if (next.every((d) => d.length === 1)) {
      void submit(next.join(""));
    }
  }

  function onKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      inputs.current[i - 1]?.focus();
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!text) return;
    e.preventDefault();
    const next = text.split("").concat(Array(6).fill("")).slice(0, 6);
    setDigits(next);
    inputs.current[Math.min(text.length, 5)]?.focus();
    if (text.length === 6) void submit(text);
  }

  async function submit(code: string) {
    if (!pendingToken) return;
    try {
      setIsLoading(true);
      const res = await fetch("/api/tenant-auth/verify-mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingToken, code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Verification failed");

      setTenantToken(data.token);
      clearMfaPending();
      toast({ title: "Welcome back", description: `Logged in as ${data.user.name}` });
      setLocation("/");
    } catch (err: any) {
      toast({
        title: "Verification failed",
        description: err.message,
        variant: "destructive",
      });
      setDigits(["", "", "", "", "", ""]);
      inputs.current[0]?.focus();
    } finally {
      setIsLoading(false);
    }
  }

  async function resend() {
    if (!pendingToken || resendIn > 0) return;
    try {
      const res = await fetch("/api/tenant-auth/resend-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingToken }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Resend failed");
      setResendIn(60);
      toast({ title: "New code sent", description: "Check your server logs for the lab code." });
    } catch (err: any) {
      toast({ title: "Couldn't resend", description: err.message, variant: "destructive" });
    }
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* LEFT: same blue marketing pane as Login */}
      <div className="lg:w-1/2 bg-blue-600 flex items-center justify-center p-8 min-h-[40vh] lg:min-h-screen">
        <div className="text-center text-white/90 max-w-md">
          <div className="mx-auto w-16 h-16 bg-white/15 backdrop-blur rounded-2xl flex items-center justify-center mb-6">
            <MessageSquare className="w-8 h-8" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight">Textitie</h1>
          <p className="mt-3 text-white/70 text-sm">Marketing pitch — content coming soon</p>
        </div>
      </div>

      {/* RIGHT: layered peek + lab card */}
      <div className="lg:w-1/2 relative bg-slate-900 min-h-[60vh] lg:min-h-screen overflow-hidden flex items-center justify-center p-6">
        <img
          src={peekImage}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover object-center"
        />
        <div className="absolute inset-0 bg-blue-900/60 backdrop-blur-[2px]" />

        <div className="relative z-10 w-full max-w-sm">
          <div className="bg-slate-900/85 backdrop-blur-md border border-white/10 rounded-2xl shadow-2xl p-6 text-white">
            <div className="text-center mb-5">
              <div className="inline-flex items-center gap-2 mb-3">
                <div className="w-10 h-10 bg-amber-400/20 rounded-lg flex items-center justify-center">
                  <FlaskConical className="w-5 h-5 text-amber-300" />
                </div>
                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-400/20 text-amber-300 text-xs font-semibold">
                  Lab Card
                </span>
              </div>
              <h2 className="text-2xl font-bold tracking-tight">Enter your code</h2>
              <p className="text-slate-400 text-xs mt-1">
                We sent a 6-digit code to <span className="text-slate-200">{maskedEmail}</span>
              </p>
            </div>

            <div className="flex justify-between gap-2 mb-5">
              {digits.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    inputs.current[i] = el;
                  }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={d}
                  onChange={(e) => setDigit(i, e.target.value)}
                  onKeyDown={(e) => onKeyDown(i, e)}
                  onPaste={onPaste}
                  disabled={isLoading}
                  className="w-11 h-12 text-center text-xl font-semibold rounded-lg bg-slate-800/60 border border-white/10 text-white focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/30"
                />
              ))}
            </div>

            {labCode && (
              <div className="mb-5 rounded-xl border border-blue-400/30 bg-blue-950/40 px-4 py-3 text-center">
                <div className="text-[10px] font-semibold tracking-[0.2em] text-blue-300/80 uppercase">
                  Lab Mode — Your Code
                </div>
                <div className="mt-2 font-mono text-2xl font-bold tracking-[0.4em] text-blue-300">
                  {labCode.split("").join(" ")}
                </div>
              </div>
            )}

            <Button
              type="button"
              size="lg"
              disabled={isLoading || digits.some((d) => !d)}
              onClick={() => submit(digits.join(""))}
              className="w-full bg-blue-600 hover:bg-blue-700 font-medium"
            >
              {isLoading ? "Verifying..." : "Verify"}
            </Button>

            <div className="mt-5 text-center text-sm">
              <button
                type="button"
                onClick={resend}
                disabled={resendIn > 0}
                className="text-blue-400 hover:text-blue-300 font-medium disabled:text-slate-500 disabled:cursor-not-allowed"
              >
                {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
              </button>
            </div>

            <p className="mt-4 text-center text-[11px] text-amber-300/80 italic">
              Beta: code is in your server logs until SES is wired.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
