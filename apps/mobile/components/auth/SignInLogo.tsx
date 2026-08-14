import { Image } from "react-native";
import { SvgXml } from "react-native-svg";

/** Rendered box for a custom (tenant-uploaded) logo — wide, like the web
 *  header treatment, vs the square-ish default brain mark. */
const CUSTOM_LOGO_WIDTH = 220;
const CUSTOM_LOGO_HEIGHT = 72;

/**
 * Sign-in screen logo: the tenant's uploaded logo when the environment's
 * `/api/auth/options` response (or its cache) carries one, else the default
 * ThinkWork mark. Uploads may be raster (png/jpeg/webp) or SVG data URLs;
 * React Native's Image can't render SVG, so those go through SvgXml.
 */
export function SignInLogo({ logoDataUrl }: { logoDataUrl: string | null }) {
  if (logoDataUrl?.startsWith("data:image/svg")) {
    const xml = decodeSvgDataUrl(logoDataUrl);
    if (xml) {
      return (
        <SvgXml
          xml={xml}
          width={CUSTOM_LOGO_WIDTH}
          height={CUSTOM_LOGO_HEIGHT}
        />
      );
    }
  } else if (logoDataUrl) {
    return (
      <Image
        source={{ uri: logoDataUrl }}
        style={{ width: CUSTOM_LOGO_WIDTH, height: CUSTOM_LOGO_HEIGHT }}
        resizeMode="contain"
      />
    );
  }
  return (
    <Image
      source={require("@/assets/logo.png")}
      style={{ width: 96, height: 78 }}
      resizeMode="contain"
    />
  );
}

export function decodeSvgDataUrl(dataUrl: string): string | null {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0) return null;
  const header = dataUrl.slice(0, commaIndex);
  const payload = dataUrl.slice(commaIndex + 1);
  try {
    if (/;base64$/i.test(header)) {
      return utf8FromBinary(atob(payload));
    }
    return decodeURIComponent(payload);
  } catch {
    return null;
  }
}

/** atob yields a Latin-1 binary string; re-decode its bytes as UTF-8 so
 *  accented characters in SVG text survive. */
function utf8FromBinary(binary: string): string {
  let percentEncoded = "";
  for (let index = 0; index < binary.length; index += 1) {
    percentEncoded += `%${binary.charCodeAt(index).toString(16).padStart(2, "0")}`;
  }
  try {
    return decodeURIComponent(percentEncoded);
  } catch {
    return binary;
  }
}
