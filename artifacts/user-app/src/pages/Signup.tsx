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
import { formatUSPhone } from "@/lib/profile";
import { MessageSquare, Sparkles } from "lucide-react";
import peekImage from "@assets/landing-peek.png";

const signupSchema = z.object({
  fullName: z.string().min(2, "Please enter your full name"),
  phone: z
    .string()
    .refine((v) => v.replace(/\D/g, "").length === 10, "Enter a valid 10-digit US phone number"),
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
    defaultValues: { fullName: "", phone: "", email: "", password: "" },
  });

  async function onSubmit(values: z.infer<typeof signupSchema>) {
    try {
      setIsLoading(true);
      // The tenant is created under the person's full name. Phone is persisted
      // on the owner's user record as A2P 10DLC opt-in evidence (the consent
      // text references "your phone number").
      const res = await fetch("/api/tenant-auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: values.fullName,
          phone: values.phone,
          email: values.email,
          password: values.password,
          plan: isTrial ? "trial" : "paid",
        }),
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
      <div className="lg:w-1/2 bg-blue-600 flex flex-col items-center justify-center p-8 min-h-[40vh] lg:min-h-screen">
        <div className="text-center text-white/90 max-w-md">
          <div className="mx-auto w-16 h-16 bg-white/15 backdrop-blur rounded-2xl flex items-center justify-center mb-6">
            <MessageSquare className="w-8 h-8" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight">Textitie</h1>
          <p className="mt-3 text-white/70 text-sm">Two-way SMS for teams that actually answer</p>
        </div>

        {/* A2P 10DLC transparency note (matches Login footer) */}
        <p className="mt-10 max-w-sm text-center text-[11px] leading-relaxed text-white/75">
          OTP security texts and customer support messages only. Message
          and data rates may apply. Message frequency varies. Reply HELP
          for help or STOP to cancel.
        </p>

        <p className="mt-5 text-center text-xs text-white/60">info@textitie.com</p>

        <div className="mt-4 flex items-center gap-4 text-xs text-white/70">
          <button
            type="button"
            onClick={() => setLocation("/privacy")}
            className="hover:text-white underline-offset-4 hover:underline"
            data-testid="link-privacy"
          >
            Privacy Policy
          </button>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            onClick={() => setLocation("/terms")}
            className="hover:text-white underline-offset-4 hover:underline"
            data-testid="link-terms"
          >
            Terms of Service
          </button>
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

        <div className="relative z-10 w-full max-w-[460px]">
          <div className="bg-slate-900/85 backdrop-blur-md border border-white/10 rounded-2xl shadow-2xl px-8 py-12 text-white min-h-[640px] flex flex-col">
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
              {/* A2P 10DLC transparency note (matches Login right pane) */}
              <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
                OTP security texts and customer support messages only.
                Message and data rates may apply. Message frequency varies.
                Reply HELP for help or STOP to cancel.
              </p>
            </div>

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="fullName"
                  render={({ field }) => (
                    <FormItem>
                      <Label className="text-slate-300 text-xs">Full Name</Label>
                      <FormControl>
                        <Input
                          placeholder="Jane Doe"
                          autoComplete="name"
                          className="bg-slate-800/60 border-white/10 text-white placeholder:text-slate-500"
                          data-testid="signup-full-name"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <Label className="text-slate-300 text-xs">Phone</Label>
                      <FormControl>
                        <Input
                          type="tel"
                          inputMode="tel"
                          autoComplete="tel-national"
                          placeholder="(555) 123-4567"
                          maxLength={14}
                          className="bg-slate-800/60 border-white/10 text-white placeholder:text-slate-500"
                          data-testid="signup-phone"
                          value={field.value}
                          onChange={(e) => field.onChange(formatUSPhone(e.target.value))}
                          onBlur={field.onBlur}
                          name={field.name}
                          ref={field.ref}
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
                    By checking this box, I consent to receive automated
                    customer support text messages from Textitie. Consent is
                    not required to create an account or complete a service.
                    Message and data rates may apply. Message frequency
                    varies. Reply HELP for help or STOP to cancel. I agree to
                    the{" "}
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
                  disabled={isLoading}
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
            </div>

            <p className="mt-5 text-center text-xs text-slate-500">info@textitie.com</p>
          </div>
        </div>
      </div>
    </div>
  );
}
