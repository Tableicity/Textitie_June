import { useLocation, useRoute } from "wouter";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { setMfaPending } from "@/pages/Verify";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";
import { MessageSquare, Sparkles } from "lucide-react";
import peekImage from "@assets/landing-peek.png";

const signupSchema = z.object({
  companyName: z.string().min(2, "Company name is required"),
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export default function Signup() {
  const [, setLocation] = useLocation();
  const [matchTrial] = useRoute("/signup/trial");
  const isTrial = matchTrial;
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [cookiesAcknowledged, setCookiesAcknowledged] = useState(true);
  // A2P 10DLC affirmative consent — must be unchecked by default
  const [smsConsent, setSmsConsent] = useState(false);

  const form = useForm<z.infer<typeof signupSchema>>({
    resolver: zodResolver(signupSchema),
    defaultValues: { companyName: "", email: "", password: "" },
  });

  async function onSubmit(values: z.infer<typeof signupSchema>) {
    try {
      setIsLoading(true);
      const res = await fetch("/api/tenant-auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, plan: isTrial ? "trial" : "paid" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sign up failed");

      setMfaPending(data.pendingToken, data.maskedEmail);
      toast({
        title: isTrial ? "Free trial started" : "Account created",
        description: "Check your server logs for the lab code.",
      });
      setLocation("/verify");
    } catch (err: any) {
      toast({ title: "Sign up failed", description: err.message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* LEFT */}
      <div className="lg:w-1/2 bg-blue-600 flex items-center justify-center p-8 min-h-[40vh] lg:min-h-screen">
        <div className="text-center text-white/90 max-w-md">
          <div className="mx-auto w-16 h-16 bg-white/15 backdrop-blur rounded-2xl flex items-center justify-center mb-6">
            <MessageSquare className="w-8 h-8" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight">Textitie</h1>
          <p className="mt-3 text-white/70 text-sm">Marketing pitch — content coming soon</p>
        </div>
      </div>

      {/* RIGHT */}
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
                <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                  {isTrial ? (
                    <Sparkles className="w-5 h-5 text-white" />
                  ) : (
                    <MessageSquare className="w-5 h-5 text-white" />
                  )}
                </div>
                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-400/20 text-amber-300 text-xs font-semibold">
                  {isTrial ? "14-Day Free Trial" : "Beta 1.01"}
                </span>
              </div>
              <h2 className="text-2xl font-bold tracking-tight">
                {isTrial ? "Start your trial" : "Create your account"}
              </h2>
              <p className="text-slate-400 text-xs mt-1">
                {isTrial
                  ? "No credit card required · Cancel any time"
                  : "Two-way SMS for teams that actually answer"}
              </p>
            </div>

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="companyName"
                  render={({ field }) => (
                    <FormItem>
                      <Label className="text-slate-300 text-xs">Company name</Label>
                      <FormControl>
                        <Input
                          placeholder="Acme Corp"
                          className="bg-slate-800/60 border-white/10 text-white placeholder:text-slate-500"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <Label className="text-slate-300 text-xs">Email</Label>
                      <FormControl>
                        <Input
                          placeholder="you@company.com"
                          className="bg-slate-800/60 border-white/10 text-white placeholder:text-slate-500"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <Label className="text-slate-300 text-xs">Password</Label>
                      <FormControl>
                        <Input
                          type="password"
                          placeholder="At least 8 characters"
                          className="bg-slate-800/60 border-white/10 text-white placeholder:text-slate-500"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* A2P 10DLC affirmative-consent checkbox (must be unchecked by default) */}
                <label
                  className="flex items-start gap-3 pt-1 cursor-pointer select-none"
                  data-testid="sms-consent-row"
                >
                  <Checkbox
                    checked={smsConsent}
                    onCheckedChange={(v) => setSmsConsent(v === true)}
                    className="mt-0.5 border-white/30 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                    data-testid="sms-consent-checkbox"
                  />
                  <span className="text-[11px] leading-relaxed text-slate-400">
                    By providing your phone number and clicking
                    {isTrial ? ' "Start Free Trial"' : ' "Create Account"'},
                    I consent to receive one-time passcode (OTP) security
                    texts and customer support messages from Textitie.
                    Consent is not a condition of purchase. Message and
                    data rates may apply. Message frequency varies. Reply
                    HELP for help or STOP to cancel. I have read and agree
                    to the{" "}
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); setLocation("/privacy"); }}
                      className="text-blue-400 hover:text-blue-300 underline-offset-2 hover:underline"
                    >
                      Privacy Policy
                    </button>{" "}
                    and{" "}
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); setLocation("/terms"); }}
                      className="text-blue-400 hover:text-blue-300 underline-offset-2 hover:underline"
                    >
                      Terms of Service
                    </button>
                    .
                  </span>
                </label>

                <Button
                  type="submit"
                  className="w-full bg-blue-600 hover:bg-blue-700 font-medium"
                  size="lg"
                  disabled={isLoading || !smsConsent}
                  data-testid="create-account-button"
                >
                  {isLoading
                    ? "Creating..."
                    : isTrial
                    ? "Start Free Trial"
                    : "Create Account"}
                </Button>
              </form>
            </Form>

            <div className="mt-5 text-center text-sm text-slate-400">
              <p>
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => setLocation("/login")}
                  className="text-blue-400 hover:text-blue-300 font-medium"
                >
                  Sign in
                </button>
              </p>
              {!isTrial && (
                <p className="mt-1">
                  Or{" "}
                  <button
                    type="button"
                    onClick={() => setLocation("/signup/trial")}
                    className="text-blue-400 hover:text-blue-300 font-medium"
                  >
                    Start a Free Trial
                  </button>
                </p>
              )}
            </div>

            <p className="mt-5 text-center text-xs text-slate-500">info@textitie.com</p>
          </div>
        </div>
      </div>
    </div>
  );
}
