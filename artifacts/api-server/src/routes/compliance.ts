import { Router, type IRouter } from "express";
import { db, tenantsTable } from "@workspace/db";

const router: IRouter = Router();

type TwilioEnv = { accountSid: string; authToken: string };

function twilioEnv(): TwilioEnv | null {
  const accountSid = process.env["TWILIO_ACCOUNT_SID"]?.trim();
  const authToken = process.env["TWILIO_AUTH_TOKEN"]?.trim();
  if (!accountSid || !authToken) return null;
  return { accountSid, authToken };
}

async function fetchTwilioResource(
  url: string,
  env: TwilioEnv,
): Promise<Record<string, unknown> | null> {
  try {
    const auth = Buffer.from(`${env.accountSid}:${env.authToken}`).toString(
      "base64",
    );
    const resp = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!resp.ok) return null;
    return (await resp.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

router.get("/compliance", async (req, res): Promise<void> => {
  const env = twilioEnv();

  const brandSid = process.env["Brand_registration_SID"]?.trim() ?? null;
  const bundleSid = process.env["Trust_Hub_A2P_Bundle_SID"]?.trim() ?? null;
  const profileSid =
    process.env["Connected_Customer_Profile_SID"]?.trim() ?? null;

  let brandRegistration = {
    sid: brandSid,
    status: null as string | null,
    friendlyName: null as string | null,
    detail: null as string | null,
  };
  let trustHubBundle = {
    sid: bundleSid,
    status: null as string | null,
    friendlyName: null as string | null,
    detail: null as string | null,
  };
  let customerProfile = {
    sid: profileSid,
    status: null as string | null,
    friendlyName: null as string | null,
    detail: null as string | null,
  };

  if (env && brandSid) {
    const data = await fetchTwilioResource(
      `https://messaging.twilio.com/v1/a2p/BrandRegistrations/${brandSid}`,
      env,
    );
    if (data) {
      brandRegistration = {
        sid: brandSid,
        status: (data.status as string) ?? null,
        friendlyName: (data.brand_type as string) ?? brandSid,
        detail: data.brand_score
          ? `Score: ${data.brand_score}, Identity: ${data.identity_status ?? "unknown"}`
          : null,
      };
    } else {
      brandRegistration.detail = "Failed to fetch from Twilio";
    }
  } else if (!env) {
    brandRegistration.detail = "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set";
  } else {
    brandRegistration.detail = "Brand_registration_SID not configured";
  }

  if (env && bundleSid) {
    const data = await fetchTwilioResource(
      `https://trusthub.twilio.com/v1/TrustProducts/${bundleSid}`,
      env,
    );
    if (data) {
      trustHubBundle = {
        sid: bundleSid,
        status: (data.status as string) ?? null,
        friendlyName: (data.friendly_name as string) ?? null,
        detail: data.valid_until
          ? `Valid until: ${data.valid_until}`
          : null,
      };
    } else {
      trustHubBundle.detail = "Failed to fetch from Twilio";
    }
  } else if (!env) {
    trustHubBundle.detail = "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set";
  } else {
    trustHubBundle.detail = "Trust_Hub_A2P_Bundle_SID not configured";
  }

  if (env && profileSid) {
    const data = await fetchTwilioResource(
      `https://trusthub.twilio.com/v1/CustomerProfiles/${profileSid}`,
      env,
    );
    if (data) {
      customerProfile = {
        sid: profileSid,
        status: (data.status as string) ?? null,
        friendlyName: (data.friendly_name as string) ?? null,
        detail: data.valid_until
          ? `Valid until: ${data.valid_until}`
          : null,
      };
    } else {
      customerProfile.detail = "Failed to fetch from Twilio";
    }
  } else if (!env) {
    customerProfile.detail = "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set";
  } else {
    customerProfile.detail = "Connected_Customer_Profile_SID not configured";
  }

  const tenants = await db
    .select({
      slug: tenantsTable.slug,
      name: tenantsTable.name,
      phoneNumber: tenantsTable.phoneNumber,
      region: tenantsTable.region,
    })
    .from(tenantsTable)
    .orderBy(tenantsTable.id);

  const tenantNumbers = tenants.map((t) => ({
    tenantSlug: t.slug,
    tenantName: t.name,
    phoneNumber: t.phoneNumber,
    region: t.region,
  }));

  req.log.info("Compliance report generated");

  res.json({
    brandRegistration,
    trustHubBundle,
    customerProfile,
    tenantNumbers,
  });
});

export default router;
