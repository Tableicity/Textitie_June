import { useLocation } from "wouter";
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
import { MessageSquare, Cookie } from "lucide-react";
import peekImage from "@assets/landing-peek.png";

const loginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [cookiesAcknowledged, setCookiesAcknowledged] = useState(false);

  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: z.infer<typeof loginSchema>) {
    try {
      setIsLoading(true);
      const res = await fetch("/api/tenant-auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Login failed");
      }

      const data = await res.json();
      if (data.requiresMfa) {
        setMfaPending(data.pendingToken, data.maskedEmail);
        toast({ title: "Code sent", description: "Check your server logs for the lab code." });
        setLocation("/verify");
        return;
      }
      toast({ title: "Welcome back", description: `Logged in as ${data.user?.name ?? "user"}` });
      setLocation("/");
    } catch (error: any) {
      toast({
        title: "Authentication failed",
        description: error.message || "Invalid credentials",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }

  function comingSoon(label: string) {
    toast({
      title: `${label} — coming soon`,
      description: "This flow is wired in Stage 2 (Lab Code) and Stage 3 (Sign Up).",
    });
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* LEFT: Marketing pitch — solid blue, content TBD */}
      <div className="lg:w-1/2 bg-blue-600 flex items-center justify-center p-8 min-h-[40vh] lg:min-h-screen">
        <div className="text-center text-white/90 max-w-md">
          <div className="mx-auto w-16 h-16 bg-white/15 backdrop-blur rounded-2xl flex items-center justify-center mb-6">
            <MessageSquare className="w-8 h-8" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight">Textitie</h1>
          <p className="mt-3 text-white/70 text-sm">Marketing pitch — content coming soon</p>
        </div>
      </div>

      {/* RIGHT: Layered peek view + login card */}
      <div className="lg:w-1/2 relative bg-slate-900 min-h-[60vh] lg:min-h-screen overflow-hidden flex items-center justify-center p-6">
        {/* Layer A: peek PNG */}
        <img
          src={peekImage}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover object-center"
        />
        {/* Layer B: blue opacity filter */}
        <div className="absolute inset-0 bg-blue-900/60 backdrop-blur-[2px]" />

        {/* Layer C: glass card stack */}
        <div className="relative z-10 w-full max-w-sm">
          <div className="bg-slate-900/85 backdrop-blur-md border border-white/10 rounded-2xl shadow-2xl p-6 text-white">
            {/* Header */}
            <div className="text-center mb-5">
              <div className="inline-flex items-center gap-2 mb-3">
                <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                  <MessageSquare className="w-5 h-5 text-white" />
                </div>
                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-400/20 text-amber-300 text-xs font-semibold">
                  Beta 1.01
                </span>
              </div>
              <h2 className="text-2xl font-bold tracking-tight">TEXTITIE</h2>
              <p className="text-slate-400 text-xs mt-1">Two-way SMS for teams that actually answer</p>
            </div>

            {/* Layer D: nested cookie card (dismissible) */}
            {!cookiesAcknowledged && (
              <div className="mb-5 bg-slate-800/80 border border-white/10 rounded-lg p-3">
                <div className="flex items-start gap-2 mb-2">
                  <Cookie className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold">We value your privacy</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      We use cookies to enhance your browsing experience. By clicking "Accept", you consent to our use of cookies.
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-1 h-8 text-xs bg-transparent border-white/20 text-white hover:bg-white/10 hover:text-white"
                    onClick={() => setCookiesAcknowledged(true)}
                  >
                    Reject All
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="flex-1 h-8 text-xs bg-blue-600 hover:bg-blue-700"
                    onClick={() => setCookiesAcknowledged(true)}
                  >
                    Accept All
                  </Button>
                </div>
              </div>
            )}

            {/* Login form */}
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
                          placeholder="••••••••"
                          className="bg-slate-800/60 border-white/10 text-white placeholder:text-slate-500"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  className="w-full bg-blue-600 hover:bg-blue-700 font-medium"
                  size="lg"
                  disabled={isLoading}
                >
                  {isLoading ? "Signing in..." : "Sign In"}
                </Button>
              </form>
            </Form>

            {/* Sign up + Free Trial links */}
            <div className="mt-5 text-center text-sm text-slate-400 space-y-1">
              <p>
                Don't have an account?{" "}
                <button
                  type="button"
                  onClick={() => comingSoon("Create account")}
                  className="text-blue-400 hover:text-blue-300 font-medium"
                >
                  Create one
                </button>
              </p>
              <p>
                Or{" "}
                <button
                  type="button"
                  onClick={() => comingSoon("Free Trial")}
                  className="text-blue-400 hover:text-blue-300 font-medium"
                >
                  Start a Free Trial
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
