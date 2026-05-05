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
import { MessageSquare } from "lucide-react";
import peekImage from "@assets/landing-peek.png";

const loginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

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


  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* LEFT: Marketing pitch + sign-up links */}
      <div className="lg:w-1/2 bg-blue-600 flex flex-col items-center justify-center p-8 min-h-[40vh] lg:min-h-screen">
        <div className="text-center text-white/90 max-w-md">
          <div className="mx-auto w-16 h-16 bg-white/15 backdrop-blur rounded-2xl flex items-center justify-center mb-6">
            <MessageSquare className="w-8 h-8" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight">Textitie</h1>
        </div>

        <div className="mt-10 text-center text-sm text-white/85 space-y-1">
          <p>
            Don't have an account?{" "}
            <button
              type="button"
              onClick={() => setLocation("/signup")}
              className="text-white underline-offset-4 hover:underline font-semibold"
            >
              Create one
            </button>
          </p>
          <p>
            Or{" "}
            <button
              type="button"
              onClick={() => setLocation("/signup/trial")}
              className="text-white underline-offset-4 hover:underline font-semibold"
            >
              Start a Free Trial
            </button>
          </p>
        </div>

        <p className="mt-5 text-center text-xs text-white/60">info@textitie.com</p>
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
        <div className="relative z-10 w-full max-w-[460px]">
          <div className="bg-slate-900/85 backdrop-blur-md border border-white/10 rounded-2xl shadow-2xl px-8 py-12 text-white">
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

          </div>
        </div>
      </div>
    </div>
  );
}
