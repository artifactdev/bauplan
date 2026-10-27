import webpush from "web-push";
import de from "@/locales/de/push.json";
import en from "@/locales/en/push.json";
import { pushLink, reminderJobs, validPushJob, type PushJob } from "@/lib/push";
import { pushRepo, sqliteRepo, type PushDevice } from "./repo";

export async function pushConfiguration() {
  const email = await pushRepo.contactEmail();
  if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) return null;
  const subject = `mailto:${email}`;
  const keys = await pushRepo.keys(() => webpush.generateVAPIDKeys());
  return { ...keys, subject };
}

function message(language: "de" | "en", kind: PushJob["kind"] | "test", url: string, tag: string) {
  const text = language === "en" ? en : de;
  return JSON.stringify({ title: text.title, body: text[kind], url, tag });
}

async function send(device: PushDevice, payload: string, ttl = 3600) {
  const config = await pushConfiguration();
  if (!config) throw new Error("push.not_configured");
  await webpush.sendNotification(device.subscription, payload, {
    vapidDetails: {
      subject: config.subject,
      publicKey: config.publicKey,
      privateKey: config.privateKey,
    },
    TTL: ttl,
    timeout: 15_000,
  });
}

export async function testPush(userId: string, endpoint: string) {
  const device = (await pushRepo.devices(userId)).find(
    (item) => item.subscription.endpoint === endpoint,
  );
  if (!device) throw new Error("push.device_missing");
  try {
    await send(device, message(device.language, "test", "/einstellungen", "bauplan-test"));
  } catch (error) {
    if (error instanceof webpush.WebPushError && [404, 410].includes(error.statusCode))
      await pushRepo.removeDevice(device.id);
    throw error;
  }
}

let running: Promise<void> | null = null;
export function runPushCycle(now = new Date()): Promise<void> {
  if (running) return running;
  running = processPush(now).finally(() => {
    running = null;
  });
  return running;
}

async function processPush(now: Date) {
  if (!(await pushConfiguration())) return;
  await pushRepo.prepare(reminderJobs(await sqliteRepo().getAll(), now), now);
  for (let count = 0; count < 100; count++) {
    const deliveryTime = new Date();
    const delivery = await pushRepo.claim(deliveryTime);
    if (!delivery) break;
    const { job, device, attempts } = delivery;
    try {
      // Check current statuses, ownership and dates immediately before sending, not just at enqueue.
      if (!validPushJob(job, await sqliteRepo().getAll(), deliveryTime)) {
        await pushRepo.finish(job.id, device.id, true, attempts, deliveryTime);
        continue;
      }
      await send(
        device,
        message(device.language, job.kind, pushLink(job), `bauplan:${job.id}`),
        Math.max(0, Math.min(3600, Math.floor((Date.parse(job.expiresAt) - Date.now()) / 1000))),
      );
      await pushRepo.finish(job.id, device.id, true, attempts, new Date());
    } catch (error) {
      console.error("[push] Delivery failed", {
        jobId: job.id,
        attempt: attempts + 1,
        status: error instanceof webpush.WebPushError ? error.statusCode : undefined,
      });
      if (error instanceof webpush.WebPushError && [404, 410].includes(error.statusCode))
        await pushRepo.removeDevice(device.id);
      else await pushRepo.finish(job.id, device.id, false, attempts + 1, new Date());
    }
  }
}

export function wakePush() {
  void runPushCycle().catch((error: unknown) => console.error("[push] Processing failed", error));
}
