import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const tenantId = process.env.TENANT_ID?.trim();
if (!tenantId) {
  fail("Missing TENANT_ID. Set TENANT_ID and rerun.");
}

const confirm = process.env.CONFIRM;
if (confirm !== "YES") {
  fail("Missing or invalid CONFIRM. Set CONFIRM=YES to proceed.");
}

const countRaw = process.env.COUNT ?? "25";
const count = Number(countRaw);
if (!Number.isFinite(count) || count <= 0) {
  fail("Invalid COUNT. Use a positive number.");
}

const projectIdFromEnv =
  process.env.FIREBASE_PROJECT_ID ||
  process.env.GCLOUD_PROJECT ||
  process.env.GOOGLE_CLOUD_PROJECT;

const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

const initWithAppDefault = () => {
  const options: { credential: ReturnType<typeof applicationDefault>; projectId?: string } = {
    credential: applicationDefault(),
  };
  if (projectIdFromEnv) {
    options.projectId = projectIdFromEnv;
  }
  initializeApp(options);
};

const initWithServiceAccount = () => {
  if (!credentialsPath) return false;
  const raw = readFileSync(resolve(credentialsPath), "utf8");
  const serviceAccount = JSON.parse(raw);
  const options: { credential: ReturnType<typeof cert>; projectId?: string } = {
    credential: cert(serviceAccount),
  };
  const projectId = projectIdFromEnv || serviceAccount.project_id;
  if (projectId) {
    options.projectId = projectId;
  }
  initializeApp(options);
  return true;
};

try {
  initWithAppDefault();
} catch (err) {
  if (!initWithServiceAccount()) {
    console.error("Failed to initialize firebase-admin.");
    console.error("Set GOOGLE_APPLICATION_CREDENTIALS or configure ADC.");
    console.error(err);
    process.exit(1);
  }
}

async function main() {
  const db = getFirestore();
  const ref = db.collection("tenants").doc(tenantId).collection("contracts");

  for (let i = 1; i <= count; i += 1) {
    await ref.add({
      createdAt: FieldValue.serverTimestamp(),
      status: "active",
      parties: {
        tenant: { fullName: `Tenant ${i}` },
        owner: { fullName: `Owner ${i}` },
      },
      property: {
        title: `Property ${i}`,
        address: `Address ${i}`,
      },
    });
  }

  console.log(`Seeded ${count} contracts into tenant ${tenantId}`);
}

main().catch((err) => {
  console.error("Unhandled error while seeding contracts.");
  console.error(err);
  process.exit(1);
});
