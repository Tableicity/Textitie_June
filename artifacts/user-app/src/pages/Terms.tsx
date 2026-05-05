import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft, MessageSquare } from "lucide-react";

export default function Terms() {
  const [, setLocation] = useLocation();
  const updated = "May 5, 2026";

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-blue-600 text-white">
        <div className="max-w-4xl mx-auto px-6 py-6 flex items-center justify-between">
          <button
            onClick={() => setLocation("/login")}
            className="inline-flex items-center gap-2 text-white/90 hover:text-white"
            data-testid="back-to-login"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm font-medium">Back to sign in</span>
          </button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-white/15 backdrop-blur rounded-md flex items-center justify-center">
              <MessageSquare className="w-4 h-4" />
            </div>
            <span className="font-bold tracking-tight">Textitie</span>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold text-slate-900">Terms of Service</h1>
        <p className="mt-2 text-sm text-slate-500">Last updated: {updated}</p>

        <div className="prose prose-slate mt-8 max-w-none">
          <h2 className="text-xl font-semibold text-slate-900 mt-8">1. Acceptance</h2>
          <p className="text-slate-700 leading-relaxed">
            By creating a Textitie account or using the service, you agree to
            these Terms of Service ("Terms"). If you are accepting on behalf
            of an organization, you represent that you have authority to
            bind that organization. If you do not agree, do not use the
            service.
          </p>

          <h2 className="text-xl font-semibold text-slate-900 mt-8">2. The service</h2>
          <p className="text-slate-700 leading-relaxed">
            Textitie is a multi-tenant two-way SMS platform that lets
            businesses send and receive SMS, manage agents, automate
            replies, and run campaigns. SMS is delivered through downstream
            carriers (currently Twilio) and US mobile networks. Delivery is
            subject to carrier acceptance, A2P 10DLC registration status,
            recipient opt-out state, and other regulatory rules.
          </p>

          <h2 className="text-xl font-semibold text-slate-900 mt-8">3. Accounts and security</h2>
          <p className="text-slate-700 leading-relaxed">
            You are responsible for safeguarding your credentials and for
            all activity under your account. You agree to enable multi-factor
            authentication where offered, to keep contact information
            current, and to notify us promptly of any suspected unauthorized
            use.
          </p>

          <h2 className="text-xl font-semibold text-slate-900 mt-8">4. Acceptable use</h2>
          <p className="text-slate-700 leading-relaxed">
            You will not use Textitie to send messages that are unlawful,
            deceptive, harassing, defamatory, or infringing. Specifically
            prohibited content categories include the SHAFT-C list (Sex,
            Hate, Alcohol, Firearms, Tobacco, Cannabis) when not properly
            registered, phishing, malware, pyramid schemes, and any content
            prohibited by US carrier policies. You will obtain valid prior
            express written consent from every recipient before sending
            marketing SMS, in accordance with the TCPA and CTIA guidelines.
          </p>

          <h2 className="text-xl font-semibold text-slate-900 mt-8">5. A2P 10DLC and compliance</h2>
          <p className="text-slate-700 leading-relaxed">
            US A2P 10DLC requires every business sending SMS to US mobile
            numbers to register a Brand and Campaign with The Campaign
            Registry (TCR). You are responsible for providing accurate
            registration information and for the use cases declared in your
            campaign. Textitie may suspend sending on numbers that are not
            properly registered or that exceed carrier throughput limits.
          </p>

          <h2 className="text-xl font-semibold text-slate-900 mt-8">6. SMS program terms</h2>
          <div className="text-slate-700 leading-relaxed p-4 bg-blue-50 border border-blue-200 rounded-md space-y-2">
            <p><strong>Program description.</strong> Textitie sends one-time passcode (OTP) security texts, customer-support replies, and (where the sending business is properly registered and you have opted in to that business) transactional and marketing SMS.</p>
            <p><strong>Message and data rates may apply.</strong> Standard message and data rates from your wireless carrier may apply to every message sent or received.</p>
            <p><strong>Message frequency varies.</strong> The number of messages you receive depends on your interactions with the platform and the businesses you have opted in to. OTPs are sent only when you request them.</p>
            <p><strong>How to get help.</strong> Reply <code className="px-1 py-0.5 bg-white rounded">HELP</code> to any Textitie message for assistance, or email <a href="mailto:info@textitie.com" className="text-blue-600 hover:underline">info@textitie.com</a>.</p>
            <p><strong>How to opt out.</strong> Reply <code className="px-1 py-0.5 bg-white rounded">STOP</code>, <code className="px-1 py-0.5 bg-white rounded">UNSUBSCRIBE</code>, <code className="px-1 py-0.5 bg-white rounded">CANCEL</code>, <code className="px-1 py-0.5 bg-white rounded">END</code>, or <code className="px-1 py-0.5 bg-white rounded">QUIT</code> to any message to stop receiving texts from that sender immediately.</p>
            <p><strong>Carriers.</strong> Supported on all major US carriers. Carriers are not liable for delayed or undelivered messages.</p>
          </div>

          <h2 className="text-xl font-semibold text-slate-900 mt-8">7. Opt-out handling</h2>
          <p className="text-slate-700 leading-relaxed">
            Reply keywords <code className="px-1 py-0.5 bg-slate-100 rounded">STOP</code>,
            <code className="px-1 py-0.5 bg-slate-100 rounded">UNSUBSCRIBE</code>,
            <code className="px-1 py-0.5 bg-slate-100 rounded">CANCEL</code>,
            <code className="px-1 py-0.5 bg-slate-100 rounded">END</code>, and
            <code className="px-1 py-0.5 bg-slate-100 rounded">QUIT</code> trigger
            an automatic, platform-wide opt-out for the originating number
            on the receiving tenant. Reply
            <code className="px-1 py-0.5 bg-slate-100 rounded">HELP</code> for
            assistance. You may not bypass or override these opt-outs.
          </p>

          <h2 className="text-xl font-semibold text-slate-900 mt-8">7. Fees and credits</h2>
          <p className="text-slate-700 leading-relaxed">
            Subscription fees and per-message credits are billed via Stripe
            on the plan you select. Usage in excess of plan allotments is
            billed against your credit balance. Free trials end automatically
            unless a paid plan is selected. All fees are non-refundable
            except as required by law.
          </p>

          <h2 className="text-xl font-semibold text-slate-900 mt-8">8. Customer data</h2>
          <p className="text-slate-700 leading-relaxed">
            You retain ownership of contacts, message content, and other
            data you submit ("Customer Data"). You grant Textitie a limited
            license to process Customer Data solely to provide the service.
            Our handling of Customer Data is described in our{" "}
            <button
              onClick={() => setLocation("/privacy")}
              className="text-blue-600 hover:underline"
            >
              Privacy Policy
            </button>.
          </p>

          <h2 className="text-xl font-semibold text-slate-900 mt-8">9. Service availability</h2>
          <p className="text-slate-700 leading-relaxed">
            We will use commercially reasonable efforts to keep the service
            available. The service is provided "as is" and "as available"
            without warranties of any kind, express or implied. SMS delivery
            depends on third parties beyond our control.
          </p>

          <h2 className="text-xl font-semibold text-slate-900 mt-8">10. Limitation of liability</h2>
          <p className="text-slate-700 leading-relaxed">
            To the maximum extent permitted by law, Textitie's aggregate
            liability arising out of or related to the service will not
            exceed the fees paid by you in the twelve months preceding the
            event giving rise to the claim. Textitie will not be liable for
            indirect, incidental, special, consequential, or punitive
            damages.
          </p>

          <h2 className="text-xl font-semibold text-slate-900 mt-8">11. Termination</h2>
          <p className="text-slate-700 leading-relaxed">
            You may cancel at any time from the Billing page. We may
            suspend or terminate your account if you violate these Terms,
            if your account is past due, or if continued service exposes us
            to legal or carrier risk. On termination we will delete or
            return Customer Data within 30 days, subject to legal retention
            requirements.
          </p>

          <h2 className="text-xl font-semibold text-slate-900 mt-8">12. Changes</h2>
          <p className="text-slate-700 leading-relaxed">
            We may update these Terms. Material changes will be announced
            with at least 14 days notice. Continued use of the service after
            the effective date constitutes acceptance.
          </p>

          <h2 className="text-xl font-semibold text-slate-900 mt-8">13. Governing law</h2>
          <p className="text-slate-700 leading-relaxed">
            These Terms are governed by the laws of the State of Delaware,
            USA, without regard to its conflict-of-laws rules. Disputes
            will be resolved in the state or federal courts located in
            Delaware.
          </p>

          <h2 className="text-xl font-semibold text-slate-900 mt-8">14. Contact</h2>
          <p className="text-slate-700 leading-relaxed">
            Textitie · <a href="mailto:info@textitie.com" className="text-blue-600 hover:underline">info@textitie.com</a>
          </p>
        </div>

        <div className="mt-12 flex gap-3">
          <Button variant="outline" onClick={() => setLocation("/privacy")}>
            View Privacy Policy
          </Button>
          <Button onClick={() => setLocation("/login")}>
            Back to sign in
          </Button>
        </div>
      </main>
    </div>
  );
}
