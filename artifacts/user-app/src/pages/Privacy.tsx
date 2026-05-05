import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft, MessageSquare } from "lucide-react";

export default function Privacy() {
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
        <h1 className="text-3xl font-bold text-slate-900">Privacy Policy</h1>
        <p className="mt-2 text-sm text-slate-500">Last updated: {updated}</p>

        <div className="prose prose-slate mt-8 max-w-none">
          <h2 className="text-xl font-semibold text-slate-900 mt-8">1. Who we are</h2>
          <p className="text-slate-700 leading-relaxed">
            Textitie ("we", "us", "our") provides a two-way SMS messaging
            platform that businesses use to communicate with their customers.
            This Privacy Policy explains what information we collect, how we
            use it, and the choices you have. If you have questions, contact
            us at <a href="mailto:info@textitie.com" className="text-blue-600 hover:underline">info@textitie.com</a>.
          </p>

          <h2 className="text-xl font-semibold text-slate-900 mt-8">2. Information we collect</h2>
          <ul className="list-disc list-inside text-slate-700 leading-relaxed space-y-2">
            <li>
              <strong>Account information</strong> you provide when registering:
              name, email, phone number, organization name, role, and
              authentication credentials.
            </li>
            <li>
              <strong>Messaging data</strong>: the content of SMS messages sent
              and received through the platform, sender and recipient phone
              numbers, timestamps, delivery status, and carrier metadata.
            </li>
            <li>
              <strong>Contact records</strong> uploaded or created by your
              organization (the "Customer"), where you act as the data
              controller and Textitie acts as a data processor.
            </li>
            <li>
              <strong>Usage and device data</strong>: log files, IP address,
              browser type, pages viewed, and approximate location derived
              from IP. We use cookies and similar technologies to keep you
              signed in and to measure feature usage.
            </li>
            <li>
              <strong>Billing information</strong> processed by our payment
              provider (Stripe). We do not store full card numbers on our
              systems.
            </li>
          </ul>

          <h2 className="text-xl font-semibold text-slate-900 mt-8">3. How we use information</h2>
          <ul className="list-disc list-inside text-slate-700 leading-relaxed space-y-2">
            <li>To deliver, maintain, and secure the messaging service.</li>
            <li>To route SMS through downstream carriers (Twilio and US mobile carriers) and surface delivery status.</li>
            <li>To authenticate you and protect against fraud, abuse, and unauthorized access (including one-time passcode security texts).</li>
            <li>To send transactional and customer-support messages you have requested.</li>
            <li>To meter usage, bill subscriptions, and prevent overages.</li>
            <li>To comply with legal obligations including US carrier A2P 10DLC and TCPA requirements.</li>
            <li>To improve the product through aggregate, de-identified analytics.</li>
          </ul>

          <h2 className="text-xl font-semibold text-slate-900 mt-8">4. SMS, A2P 10DLC and consent</h2>
          <p className="text-slate-700 leading-relaxed">
            US carriers require that any business sending SMS to a US mobile
            number register an A2P 10DLC Brand and Campaign and obtain
            opt-in consent from the recipient. When you provide your phone
            number to Textitie you consent to receive one-time passcode
            security texts and customer-support messages from us.
            <strong> Consent is not a condition of any purchase.</strong>{" "}
            Message and data rates may apply, message frequency varies, and
            you may reply <code className="px-1 py-0.5 bg-slate-100 rounded">HELP</code> for
            help or <code className="px-1 py-0.5 bg-slate-100 rounded">STOP</code> at any
            time to opt out. Honoring STOP, START, UNSUBSCRIBE, and similar
            opt-out keywords is automatic and immediate across the platform.
          </p>

          <h2 className="text-xl font-semibold text-slate-900 mt-8">5. How we share information</h2>
          <p className="text-slate-700 leading-relaxed">
            We share information only to operate the service: with sub-processors
            such as Twilio (SMS delivery), our cloud hosting provider, our
            payment processor, and authorized support personnel. We do not
            sell personal information. We may disclose information when
            required by law or to protect the rights, property, or safety of
            users or the public.
          </p>

          <h2 className="text-xl font-semibold text-slate-900 mt-8">6. Data retention</h2>
          <p className="text-slate-700 leading-relaxed">
            We retain account and messaging data for the life of the account
            plus a limited period required for billing reconciliation and
            audit. Customers on regulated tiers (e.g. HIPAA-eligible plans)
            may configure shorter retention. You may request deletion of
            your personal data at any time, subject to legal record-keeping
            obligations.
          </p>

          <h2 className="text-xl font-semibold text-slate-900 mt-8">7. Your rights</h2>
          <p className="text-slate-700 leading-relaxed">
            Depending on where you live, you may have the right to access,
            correct, delete, or export your personal data, and to object to
            or restrict certain processing. California residents have
            additional rights under the CCPA/CPRA. EEA, UK, and Swiss
            residents have rights under the GDPR. To exercise any of these
            rights, email <a href="mailto:info@textitie.com" className="text-blue-600 hover:underline">info@textitie.com</a>.
          </p>

          <h2 className="text-xl font-semibold text-slate-900 mt-8">8. Security</h2>
          <p className="text-slate-700 leading-relaxed">
            We use industry-standard safeguards including TLS in transit,
            encryption at rest for our databases, scoped access controls,
            multi-factor authentication for staff, and audit logging. No
            system is perfectly secure; if you discover a vulnerability,
            please report it to <a href="mailto:info@textitie.com" className="text-blue-600 hover:underline">info@textitie.com</a>.
          </p>

          <h2 className="text-xl font-semibold text-slate-900 mt-8">9. Children</h2>
          <p className="text-slate-700 leading-relaxed">
            Textitie is not directed to children under 13 (or under 16 in
            the EEA). We do not knowingly collect personal information from
            children. If you believe a child has provided us information,
            contact us and we will delete it.
          </p>

          <h2 className="text-xl font-semibold text-slate-900 mt-8">10. Changes</h2>
          <p className="text-slate-700 leading-relaxed">
            We will update this policy from time to time. Material changes
            will be communicated by email or in-product notice at least 14
            days before they take effect.
          </p>

          <h2 className="text-xl font-semibold text-slate-900 mt-8">11. Contact</h2>
          <p className="text-slate-700 leading-relaxed">
            Textitie · <a href="mailto:info@textitie.com" className="text-blue-600 hover:underline">info@textitie.com</a>
          </p>
        </div>

        <div className="mt-12 flex gap-3">
          <Button variant="outline" onClick={() => setLocation("/terms")}>
            View Terms of Service
          </Button>
          <Button onClick={() => setLocation("/login")}>
            Back to sign in
          </Button>
        </div>
      </main>
    </div>
  );
}
