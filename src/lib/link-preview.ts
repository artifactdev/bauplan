const THUM_IO = "https://image.thum.io/get/width/800/crop/450/maxAge/24/noanimate/";

function isPrivateIpv4(hostname: string) {
  const octets = hostname.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  )
    return false;
  const [a, b, c] = octets as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

/** URL for thum.io's screenshot API, or null for unsupported/private targets. */
export function linkScreenshotUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const target = new URL(value);
    if (
      !["http:", "https:"].includes(target.protocol) ||
      target.username ||
      target.password ||
      (target.port && !["80", "443"].includes(target.port))
    )
      return null;

    const hostname = target.hostname.toLowerCase().replace(/\.$/, "");
    if (
      hostname.startsWith("[") ||
      hostname === "localhost" ||
      hostname === "example" ||
      !hostname.includes(".") ||
      /\.(localhost|local|internal|test|invalid|example|home|lan)$/.test(hostname) ||
      isPrivateIpv4(hostname)
    )
      return null;
    return `${THUM_IO}${target.href}`;
  } catch {
    return null;
  }
}
